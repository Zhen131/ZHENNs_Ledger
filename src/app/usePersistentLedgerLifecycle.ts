import {
  assertSessionQuiesceRequest,
  claimLedgerSessionPersistencePort,
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
  ledgerReducer,
  type LedgerAction,
} from "@/core/state";
import {
  evaluateLedgerResourcePolicy,
  type LedgerResourcePolicyError,
} from "@/core/validation";
