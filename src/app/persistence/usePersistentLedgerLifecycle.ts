/**
 * 这个文件管账本存取的几件大事。
 * 开机读账本，换存盘目标，停工，清空，出致命错时锁住。
 * 日常改账和存盘排队在同目录别的文件里。
 * 读到的账本超出上限时，照样打开，但只读。
 * 没有特别的决定。
 */
import {
  assertSessionQuiesceRequest,
  claimLedgerSessionPersistencePort,
  LEDGER_REPOSITORY_ERROR_CODES,
  type LedgerSession,
  type LedgerRepository,
  type SessionQuiesceRequest,
  type SessionQuiesceToken,
} from "@/platform/persistence";
import { translateDefault } from "@/ui";
import type { HydrationStatus } from "./hydrationState";
import type {
  ClearLedgerResult,
  ImportLedgerResult,
  LedgerSessionFatalSignal,
  PersistenceOperation,
  PersistenceTarget,
  PersistenceVersionState,
  RetryAttempt,
  ScheduledSnapshot,
  SessionPersistenceBinding,
} from "./usePersistentLedgerTypes";
import {
  INITIAL_PERSISTENCE_VERSION_STATE,
  isSamePersistenceTarget,
} from "./usePersistentLedgerHelpers";

type StopForImportRecoveryFatalDeps = {
  acceptingOperationsRef: { current: boolean };
  activePersistenceTargetRef: { current: PersistenceTarget };
  failedSnapshotRef: { current: ScheduledSnapshot | null };
  fatalOccurrenceRef: { current: number };
  generationRef: { current: number };
  hydratedRepositoryRef: { current: LedgerRepository | null };
  importAbortControllerRef: { current: AbortController | null };
  latestScheduledSnapshotRef: { current: ScheduledSnapshot | null };
  mountedRef: { current: boolean };
  pendingHydrationRef: {
    current: {
      repository: LedgerRepository;
      generation: number;
      serializedLedger: string;
    } | null;
  };
  persistenceVersionStateRef: { current: PersistenceVersionState };
  publishPersistenceVersionState: (nextState: PersistenceVersionState) => void;
  readOnlyRef: { current: boolean };
  retryAttemptRef: { current: unknown | null };
  sessionFatalSignalRef: { current: LedgerSessionFatalSignal | null };
  setIsReadOnly: (nextValue: boolean) => void;
  setLifecycleStatus: (nextValue: "quiescing") => void;
  setPersistenceError: (nextValue: string) => void;
  setSessionFatalSignal: (nextValue: LedgerSessionFatalSignal) => void;
};

/**
 * 这个函数在导入后没法恢复时锁住这本账。
 * 它停止接新活，改成只读，取消正在跑的导入，并发出致命信号。
 * 页面看到信号就换成出错面板，再交给外层去锁账本。
 * 只对账本文件会话起作用；同一个会话只发一次。不抛错。
 */
export function doStopForImportRecoveryFatal(
  deps: StopForImportRecoveryFatalDeps,
  message: string,
): void {
  const {
    acceptingOperationsRef,
    activePersistenceTargetRef,
    failedSnapshotRef,
    fatalOccurrenceRef,
    generationRef,
    hydratedRepositoryRef,
    importAbortControllerRef,
    latestScheduledSnapshotRef,
    mountedRef,
    pendingHydrationRef,
    persistenceVersionStateRef,
    publishPersistenceVersionState,
    readOnlyRef,
    retryAttemptRef,
    sessionFatalSignalRef,
    setIsReadOnly,
    setLifecycleStatus,
    setPersistenceError,
    setSessionFatalSignal,
  } = deps;
      const fatalSession = activePersistenceTargetRef.current.session;
      if (!fatalSession || fatalSession.storageKind !== "ledger-file") {
        return;
      }
      const existingSignal = sessionFatalSignalRef.current;
      if (existingSignal?.sessionId === fatalSession.sessionId) {
        return;
      }

      acceptingOperationsRef.current = false;
      readOnlyRef.current = true;
      importAbortControllerRef.current?.abort(
        "Ledger import recovery was blocked",
      );
      generationRef.current += 1;
      latestScheduledSnapshotRef.current = null;
      failedSnapshotRef.current = null;
      retryAttemptRef.current = null;
      pendingHydrationRef.current = null;
      hydratedRepositoryRef.current = null;
      const currentVersionState = persistenceVersionStateRef.current;
      publishPersistenceVersionState({
        ...currentVersionState,
        persistenceStatus: "error",
      });
      fatalOccurrenceRef.current += 1;
      const signal = Object.freeze({
        code: "IMPORT_RECOVERY_BLOCKED" as const,
        occurrence: fatalOccurrenceRef.current,
        sessionId: fatalSession.sessionId,
        sessionGeneration: fatalSession.generation,
      });
      sessionFatalSignalRef.current = signal;

      if (mountedRef.current) {
        setIsReadOnly(true);
        setPersistenceError(message);
        setLifecycleStatus("quiescing");
        setSessionFatalSignal(signal);
      }
}

type RunPersistenceTargetEffectDeps = {
  acceptingOperationsRef: { current: boolean };
  activePersistenceTargetRef: { current: PersistenceTarget };
  currentRepositoryRef: { current: LedgerRepository };
  importAbortControllerRef: { current: AbortController | null };
  importSessionRef: { current: LedgerSession | undefined };
  operationRef: { current: PersistenceOperation };
  operationRepositoryRef: { current: LedgerRepository | null };
  persistenceVersionStateRef: { current: PersistenceVersionState };
  repositorySwitchPermissionRef: { current: LedgerRepository | null };
  requestedPersistenceRepository: LedgerRepository;
  requestedPersistenceTarget: PersistenceTarget;
  requestedSession: LedgerSession | undefined;
  sessionPersistenceBindingsRef: {
    current: WeakMap<LedgerSession, SessionPersistenceBinding>;
  };
  sessionPersistenceOwnerRef: { current: object };
  setActivePersistenceTarget: (nextValue: PersistenceTarget) => void;
};

/**
 * 这个函数在页面请求换存盘目标时决定换不换。
 * 没有没存好的改动，或者用户已同意放弃改动，才换。
 * 正在导入时不换；导入中途目标变了，就取消那次导入。
 * 新会话第一次用时，给它领一个存盘通道。不抛错。
 */
export function runPersistenceTargetEffect(
  deps: RunPersistenceTargetEffectDeps,
): void {
  const {
    acceptingOperationsRef,
    activePersistenceTargetRef,
    currentRepositoryRef,
    importAbortControllerRef,
    importSessionRef,
    operationRef,
    operationRepositoryRef,
    persistenceVersionStateRef,
    repositorySwitchPermissionRef,
    requestedPersistenceRepository,
    requestedPersistenceTarget,
    requestedSession,
    sessionPersistenceBindingsRef,
    sessionPersistenceOwnerRef,
    setActivePersistenceTarget,
  } = deps;
    const activeTarget = activePersistenceTargetRef.current;
    const targetChanged = !isSamePersistenceTarget(
      activeTarget.repository,
      activeTarget.session,
      requestedPersistenceRepository,
      requestedSession,
    );
    const currentVersionState = persistenceVersionStateRef.current;
    const isDirty =
      currentVersionState.persistedVersion !==
      currentVersionState.mutationVersion;
    const canCommitTargetSwitch =
      targetChanged &&
      operationRef.current !== "importing" &&
      (!isDirty ||
        repositorySwitchPermissionRef.current ===
          requestedPersistenceRepository);
    const sessionToActivate = targetChanged
      ? canCommitTargetSwitch
        ? requestedSession
        : undefined
      : activeTarget.session;
    if (
      sessionToActivate &&
      !sessionPersistenceBindingsRef.current.has(sessionToActivate)
    ) {
      sessionPersistenceBindingsRef.current.set(sessionToActivate, {
        port: claimLedgerSessionPersistencePort(
          sessionToActivate,
          sessionPersistenceOwnerRef.current,
        ),
        acceptedWork: new Set(),
        quiesceRequest: null,
        quiesceDrain: null,
      });
    }

    if (canCommitTargetSwitch) {
      activePersistenceTargetRef.current = requestedPersistenceTarget;
      currentRepositoryRef.current = requestedPersistenceRepository;
      repositorySwitchPermissionRef.current = null;
      acceptingOperationsRef.current = false;
      setActivePersistenceTarget(requestedPersistenceTarget);
    }

    const readyFileImportTargetChanged =
      operationRef.current === "importing" &&
      importSessionRef.current?.storageKind === "ledger-file" &&
      !isSamePersistenceTarget(
        operationRepositoryRef.current,
        importSessionRef.current,
        requestedPersistenceRepository,
        requestedSession,
      );
    if (readyFileImportTargetChanged) {
      importAbortControllerRef.current?.abort(
        "The requested ledger-file session changed during import",
      );
    }
}

type DrainForSessionQuiesceDeps = {
  acceptingOperationsRef: { current: boolean };
  activePersistenceTargetRef: { current: PersistenceTarget };
  clearPromiseRef: { current: Promise<ClearLedgerResult> | null };
  generationRef: { current: number };
  hydrationPromisesRef: { current: Set<Promise<void>> };
  importAbortControllerRef: { current: AbortController | null };
  importPromiseRef: { current: Promise<ImportLedgerResult> | null };
  mountedRef: { current: boolean };
  requestedSession: LedgerSession | undefined;
  retryAttemptRef: { current: RetryAttempt | null };
  sessionPersistenceBindingsRef: {
    current: WeakMap<LedgerSession, SessionPersistenceBinding>;
  };
  setLifecycleStatus: (nextValue: "quiescing") => void;
  writeQueueRef: { current: Promise<void> };
};

/**
 * 这个函数回答会话的停工请求：停止接新活，等手上的活做完。
 * 手上的活包括存盘队、读账本、清空、导入、重试。
 * 都做完后，交回会话要的「活都做完了」的凭证。
 * 同一个请求再来，交回同一个结果。
 * 没有会话、通道不归这个 hook、已有别的停工请求时，抛错。
 */
export function doDrainForSessionQuiesce(
  deps: DrainForSessionQuiesceDeps,
  request: SessionQuiesceRequest,
): Promise<SessionQuiesceToken> {
  const {
    acceptingOperationsRef,
    activePersistenceTargetRef,
    clearPromiseRef,
    generationRef,
    hydrationPromisesRef,
    importAbortControllerRef,
    importPromiseRef,
    mountedRef,
    requestedSession,
    retryAttemptRef,
    sessionPersistenceBindingsRef,
    setLifecycleStatus,
    writeQueueRef,
  } = deps;
      if (!requestedSession) {
        throw new Error(
          "A lifecycle-bound LedgerSession is required for quiesce drain",
        );
      }
      assertSessionQuiesceRequest(requestedSession, request);

      const persistenceBinding =
        sessionPersistenceBindingsRef.current.get(requestedSession);
      if (!persistenceBinding) {
        throw new Error(
          "The current Hook does not own this session persistence port",
        );
      }
      if (
        persistenceBinding.quiesceRequest === request &&
        persistenceBinding.quiesceDrain
      ) {
        return persistenceBinding.quiesceDrain;
      }
      if (persistenceBinding.quiesceRequest !== null) {
        throw new Error(
          "A different session quiesce request is already draining",
        );
      }

      persistenceBinding.quiesceRequest = request;
      const isCurrentCommittedSession =
        activePersistenceTargetRef.current.session ===
        requestedSession;
      if (isCurrentCommittedSession) {
        acceptingOperationsRef.current = false;
        importAbortControllerRef.current?.abort();
        generationRef.current += 1;
        if (mountedRef.current) {
          setLifecycleStatus("quiescing");
        }
      }

      const currentAcceptedWork: Array<
        PromiseLike<unknown> | null | undefined
      > = isCurrentCommittedSession
        ? [
            writeQueueRef.current,
            ...hydrationPromisesRef.current,
            clearPromiseRef.current,
            importPromiseRef.current,
            retryAttemptRef.current?.promise,
          ]
        : [];
      const acceptedWork = [
        ...persistenceBinding.acceptedWork,
        ...currentAcceptedWork,
      ].filter(
        (operation): operation is PromiseLike<unknown> =>
          operation !== null && operation !== undefined,
      );
      const settled = Promise.allSettled(acceptedWork);
      const drain = persistenceBinding.port.completeQuiesce(
        request,
        settled,
      );
      persistenceBinding.quiesceDrain = drain;
      return drain;
}

type RunHydrationEffectDeps = {
  acceptingOperationsRef: { current: boolean };
  activePersistenceTarget: PersistenceTarget;
  activePersistenceTargetRef: { current: PersistenceTarget };
  activeRepository: LedgerRepository;
  activeSession: LedgerSession | undefined;
  clearPromiseRef: { current: Promise<ClearLedgerResult> | null };
  failedSnapshotRef: { current: ScheduledSnapshot | null };
  generationRef: { current: number };
  hydratedRepositoryRef: { current: LedgerRepository | null };
  hydrationErrorRepositoryRef: { current: LedgerRepository | null };
  hydrationPromisesRef: { current: Set<Promise<void>> };
  importAbortControllerRef: { current: AbortController | null };
  importPromiseRef: { current: Promise<ImportLedgerResult> | null };
  lastPersistedSnapshotRef: { current: string | null };
  latestScheduledSnapshotRef: { current: ScheduledSnapshot | null };
  ledgerDataRef: { current: LedgerData };
  operationRef: { current: PersistenceOperation };
  operationRepositoryRef: { current: LedgerRepository | null };
  operationTokenRef: { current: symbol | null };
  pendingHydrationRef: {
    current: {
      repository: LedgerRepository;
      generation: number;
      serializedLedger: string;
    } | null;
  };
  publishPersistenceVersionState: (nextState: PersistenceVersionState) => void;
  readOnlyRef: { current: boolean };
  reducerDispatch: (action: LedgerAction) => void;
  retryAttemptRef: { current: RetryAttempt | null };
  sessionFatalSignalRef: { current: LedgerSessionFatalSignal | null };
  setHydrationStatus: (nextValue: HydrationStatus) => void;
  setIsReadOnly: (nextValue: boolean) => void;
  setLifecycleStatus: (nextValue: "active") => void;
  setPersistenceError: (nextValue: string | null) => void;
  setPersistenceOperation: (nextValue: PersistenceOperation) => void;
  setResourcePolicyError: (
    nextValue: LedgerResourcePolicyError | null,
  ) => void;
  setSessionFatalSignal: (nextValue: LedgerSessionFatalSignal | null) => void;
  trackSessionAcceptedWork: (
    session: LedgerSession | undefined,
    work: PromiseLike<unknown>,
  ) => void;
  writeQueueRef: { current: Promise<void> };
};

/**
 * 这个函数在存盘目标确定后，开机把账本从仓库读进来。
 * 读之前先清掉上一本的状态；读到空的就新建一本空账。
 * 读到的账超出条数或大小上限，照样显示，但改成只读。
 * 读失败就把状态改成「读失败」，留一句提示。
 * 返回一个函数，页面换目标时调它，作废这次读。不抛错。
 */
export function runHydrationEffect(
  deps: RunHydrationEffectDeps,
): void | (() => void) {
  const {
    acceptingOperationsRef,
    activePersistenceTarget,
    activePersistenceTargetRef,
    activeRepository,
    activeSession,
    clearPromiseRef,
    failedSnapshotRef,
    generationRef,
    hydratedRepositoryRef,
    hydrationErrorRepositoryRef,
    hydrationPromisesRef,
    importAbortControllerRef,
    importPromiseRef,
    lastPersistedSnapshotRef,
    latestScheduledSnapshotRef,
    ledgerDataRef,
    operationRef,
    operationRepositoryRef,
    operationTokenRef,
    pendingHydrationRef,
    publishPersistenceVersionState,
    readOnlyRef,
    reducerDispatch,
    retryAttemptRef,
    sessionFatalSignalRef,
    setHydrationStatus,
    setIsReadOnly,
    setLifecycleStatus,
    setPersistenceError,
    setPersistenceOperation,
    setResourcePolicyError,
    setSessionFatalSignal,
    trackSessionAcceptedWork,
    writeQueueRef,
  } = deps;
    if (
      activePersistenceTargetRef.current !==
      activePersistenceTarget
    ) {
      return;
    }
    const generation = generationRef.current + 1;
    generationRef.current = generation;
    acceptingOperationsRef.current = true;
    setLifecycleStatus("active");
    sessionFatalSignalRef.current = null;
    setSessionFatalSignal(null);
    hydratedRepositoryRef.current = null;
    hydrationErrorRepositoryRef.current = null;
    pendingHydrationRef.current = null;
    lastPersistedSnapshotRef.current = null;
    latestScheduledSnapshotRef.current = null;
    failedSnapshotRef.current = null;
    retryAttemptRef.current = null;
    writeQueueRef.current = Promise.resolve();
    publishPersistenceVersionState(INITIAL_PERSISTENCE_VERSION_STATE);

    if (operationRef.current !== "idle") {
      importAbortControllerRef.current?.abort();
      importAbortControllerRef.current = null;
      operationRef.current = "idle";
      operationRepositoryRef.current = null;
      operationTokenRef.current = null;
      clearPromiseRef.current = null;
      importPromiseRef.current = null;
      setPersistenceOperation("idle");
    }

    setHydrationStatus("loading");
    setResourcePolicyError(null);
    readOnlyRef.current = false;
    setIsReadOnly(false);
    let cancelled = false;

    async function hydrate() {
      try {
        const savedLedger = await activeRepository.load();

        if (cancelled || generationRef.current !== generation) {
          return;
        }

        const hydratedLedger = savedLedger ?? createInitialLedgerData();
        const resourcePolicyResult =
          evaluateLedgerResourcePolicy(hydratedLedger);
        const serializedLedger = JSON.stringify(hydratedLedger);
        ledgerDataRef.current = hydratedLedger;
        lastPersistedSnapshotRef.current = serializedLedger;
        pendingHydrationRef.current = {
          repository: activeRepository,
          generation,
          serializedLedger,
        };
        hydrationErrorRepositoryRef.current = null;
        reducerDispatch({
          type: "ledger/replace",
          ledgerData: hydratedLedger,
        });

        setPersistenceError(null);
        if (resourcePolicyResult.ok) {
          readOnlyRef.current = false;
          setResourcePolicyError(null);
          setIsReadOnly(false);
        } else {
          readOnlyRef.current = true;
          setResourcePolicyError(resourcePolicyResult.errors[0]);
          setIsReadOnly(true);
        }
      } catch {
        if (cancelled || generationRef.current !== generation) {
          return;
        }

        pendingHydrationRef.current = null;
        hydratedRepositoryRef.current = null;
        hydrationErrorRepositoryRef.current = activeRepository;
        setPersistenceError(
          translateDefault("persistence.readFailed"),
        );
        setHydrationStatus("error");
      }
    }

    const hydrationPromise = hydrate();
    hydrationPromisesRef.current.add(hydrationPromise);
    trackSessionAcceptedWork(activeSession, hydrationPromise);
    void hydrationPromise.finally(() => {
      hydrationPromisesRef.current.delete(hydrationPromise);
    });

    return () => {
      cancelled = true;
    };
}
import type { LedgerData } from "@/core/models";
import {
  createInitialLedgerData,
  type LedgerAction,
} from "@/core/state";
import {
  evaluateLedgerResourcePolicy,
  type LedgerResourcePolicyError,
} from "@/core/validation";


type ClearLedgerDeps = {
  acceptingOperationsRef: { current: boolean };
  activeCapabilities: {
    canClearHydrationError: boolean;
    canClearReadyLedger: boolean;
  };
  activeRepository: LedgerRepository;
  activeSession: LedgerSession | undefined;
  clearPromiseRef: { current: Promise<ClearLedgerResult> | null };
  currentRepositoryRef: { current: LedgerRepository };
  failedSnapshotRef: { current: ScheduledSnapshot | null };
  generationRef: { current: number };
  hydratedRepositoryRef: { current: LedgerRepository | null };
  hydrationErrorRepositoryRef: { current: LedgerRepository | null };
  hydrationStatus: HydrationStatus;
  lastPersistedSnapshotRef: { current: string | null };
  latestScheduledSnapshotRef: { current: ScheduledSnapshot | null };
  ledgerDataRef: { current: LedgerData };
  mountedRef: { current: boolean };
  operationRef: { current: PersistenceOperation };
  operationRepositoryRef: { current: LedgerRepository | null };
  operationTokenRef: { current: symbol | null };
  pendingHydrationRef: {
    current: {
      repository: LedgerRepository;
      generation: number;
      serializedLedger: string;
    } | null;
  };
  publishPersistenceVersionState: (nextState: PersistenceVersionState) => void;
  readOnlyRef: { current: boolean };
  reducerDispatch: (action: LedgerAction) => void;
  retryAttemptRef: { current: RetryAttempt | null };
  setHydrationStatus: (nextValue: HydrationStatus) => void;
  setIsReadOnly: (nextValue: boolean) => void;
  setLedgerEpoch: (nextValue: (current: number) => number) => void;
  setPersistenceError: (nextValue: string | null) => void;
  setPersistenceOperation: (nextValue: PersistenceOperation) => void;
  trackSessionAcceptedWork: (
    session: LedgerSession | undefined,
    work: PromiseLike<unknown>,
  ) => void;
  writeQueueRef: { current: Promise<void> };
};

/**
 * 这个函数回答：把当前账本清空成一本空账，成没成？
 * 只有账读好了、或读失败了，且会话权限允许，才清。
 * 账本文件要先拿到会话的批准，再交给会话去清。
 * 举例：一本 5 笔交易的账，清空成功 → 答 `ok: true`，页面显示空账。
 * 失败不抛错，返回 `ok: false` 和清空失败的代码，并留一句提示。
 * 同一次清空正在跑时，交回那一次的结果。
 */
export function doClearLedger(
  deps: ClearLedgerDeps,
  confirmationNonce = "",
): Promise<ClearLedgerResult> {
  const {
    acceptingOperationsRef,
    activeCapabilities,
    activeRepository,
    activeSession,
    clearPromiseRef,
    currentRepositoryRef,
    failedSnapshotRef,
    generationRef,
    hydratedRepositoryRef,
    hydrationErrorRepositoryRef,
    hydrationStatus,
    lastPersistedSnapshotRef,
    latestScheduledSnapshotRef,
    ledgerDataRef,
    mountedRef,
    operationRef,
    operationRepositoryRef,
    operationTokenRef,
    pendingHydrationRef,
    publishPersistenceVersionState,
    readOnlyRef,
    reducerDispatch,
    retryAttemptRef,
    setHydrationStatus,
    setIsReadOnly,
    setLedgerEpoch,
    setPersistenceError,
    setPersistenceOperation,
    trackSessionAcceptedWork,
    writeQueueRef,
  } = deps;
    if (!acceptingOperationsRef.current) {
      return Promise.resolve({
        ok: false,
        code: LEDGER_REPOSITORY_ERROR_CODES.CLEAR_FAILED,
      });
    }

    if (
      operationRef.current === "clearing" &&
      operationRepositoryRef.current === activeRepository &&
      clearPromiseRef.current !== null
    ) {
      return clearPromiseRef.current;
    }

    const canClearReadyLedger =
      hydrationStatus === "ready" &&
      hydratedRepositoryRef.current === activeRepository &&
      activeCapabilities.canClearReadyLedger;
    const canRecoverHydrationError =
      hydrationStatus === "error" &&
      hydrationErrorRepositoryRef.current === activeRepository &&
      activeCapabilities.canClearHydrationError;

    if (
      operationRef.current !== "idle" ||
      readOnlyRef.current ||
      (!canClearReadyLedger && !canRecoverHydrationError)
    ) {
      return Promise.resolve({
        ok: false,
        code: LEDGER_REPOSITORY_ERROR_CODES.CLEAR_FAILED,
      });
    }

    const operationToken = Symbol("clear-ledger");
    const operationRepository = activeRepository;
    const operationSession = activeSession;
    operationRef.current = "clearing";
    operationRepositoryRef.current = operationRepository;
    operationTokenRef.current = operationToken;

    if (mountedRef.current) {
      setPersistenceOperation("clearing");
    }

    let readyClearAttempted = false;
    const clearPromise = writeQueueRef.current
      .catch(() => undefined)
      .then(async (): Promise<ClearLedgerResult> => {
        try {
          if (
            canClearReadyLedger &&
            operationSession?.storageKind === "ledger-file"
          ) {
            const readyClearPort = operationSession.readyClearPort;
            if (!readyClearPort) {
              throw new Error(
                "Ready ledger-file clear port is unavailable",
              );
            }
            const authorization =
              readyClearPort.authorizeReadyClear(
                confirmationNonce,
              );
            if (!authorization) {
              throw new Error(
                "Ready ledger-file clear authorization was rejected",
              );
            }
            readyClearAttempted = true;
            await readyClearPort.clearReadyLedger(authorization);
          } else {
            await operationRepository.clear();
          }
        } catch {
          if (
            mountedRef.current &&
            currentRepositoryRef.current === operationRepository &&
            operationTokenRef.current === operationToken
          ) {
            if (
              canClearReadyLedger &&
              operationSession?.storageKind === "ledger-file"
            ) {
              if (
                readyClearAttempted ||
                failedSnapshotRef.current === null
              ) {
                setPersistenceError(
                  readyClearAttempted
                    ? translateDefault("persistence.clearResultUnconfirmed")
                    : translateDefault("persistence.clearAuthorizationFailed"),
                );
              }
            } else {
              setPersistenceError(
                translateDefault("persistence.clearFailed"),
              );
            }
          }

          return {
            ok: false,
            code: LEDGER_REPOSITORY_ERROR_CODES.CLEAR_FAILED,
          };
        }

        if (
          mountedRef.current &&
          currentRepositoryRef.current === operationRepository &&
          operationTokenRef.current === operationToken
        ) {
          const initialLedger = createInitialLedgerData();
          const serializedInitialLedger = JSON.stringify(initialLedger);
          generationRef.current += 1;
          ledgerDataRef.current = initialLedger;
          lastPersistedSnapshotRef.current = serializedInitialLedger;
          latestScheduledSnapshotRef.current = null;
          failedSnapshotRef.current = null;
          retryAttemptRef.current = null;
          pendingHydrationRef.current = null;
          hydratedRepositoryRef.current = operationRepository;
          hydrationErrorRepositoryRef.current = null;
          publishPersistenceVersionState(
            INITIAL_PERSISTENCE_VERSION_STATE,
          );
          reducerDispatch({
            type: "ledger/replace",
            ledgerData: initialLedger,
          });
          setPersistenceError(null);
          readOnlyRef.current = false;
          setIsReadOnly(false);
          setHydrationStatus("ready");
          setLedgerEpoch((current) => current + 1);
        }

        return { ok: true };
      })
      .finally(() => {
        if (
          operationTokenRef.current !== operationToken ||
          currentRepositoryRef.current !== operationRepository
        ) {
          return;
        }

        operationRef.current = "idle";
        operationRepositoryRef.current = null;
        operationTokenRef.current = null;
        clearPromiseRef.current = null;

        if (mountedRef.current) {
          setPersistenceOperation("idle");
        }
      });

    clearPromiseRef.current = clearPromise;
    writeQueueRef.current = clearPromise.then(() => undefined);
    trackSessionAcceptedWork(operationSession, clearPromise);

    return clearPromise;

}
