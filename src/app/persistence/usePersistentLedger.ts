/**
 * 这个文件是账本存取的总 hook。
 * 它管开机读账本，改账，自动存盘，清空，导入。
 * 每件事的细节分在同目录 `usePersistentLedger*.ts` 里，这里只把它们配在一起。
 * 读好账本之前，不许改账。
 * 没有特别的决定。
 */
"use client";

import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useReducer,
  useRef,
  useState,
} from "react";
import type { LedgerData } from "@/core/models";
import {
  collectLedgerCompatibilityWarnings,
  partitionLedgerFactsForToday,
} from "@/core/policies";
import {
  LEDGER_FILE_READY_IMPORT_CAPABILITIES,
  type LedgerBackupImportEvidence,
  type LedgerSession,
  type LedgerSessionCapabilities,
  type LedgerRepository,
  type SessionQuiesceRequest,
  type SessionQuiesceToken,
} from "@/platform/persistence";
import { createInitialLedgerData } from "@/core/state";
import { useLanguage, type TranslationKey } from "@/ui";
import type { HydrationStatus } from "./hydrationState";
import {
  ledgerReducer,
  type LedgerAction,
} from "@/core/state";
import {
  type LedgerResourcePolicyError,
} from "@/core/validation";
import {
  captureLedgerTime,
  millisecondsUntilNextLocalMidnight,
  systemLedgerClock,
  type LedgerClock,
  type LedgerTimeSnapshot,
} from "@/core/shared";
import type {
  PersistentLedgerState,
  LedgerSessionFatalSignal,
  PersistenceOperation,
  ApplyLedgerActionResult,
  PersistenceVersionState,
  ScheduledSnapshot,
  RetryAttempt,
  SessionPersistenceBinding,
  PersistenceTarget,
  PersistenceAttemptResult,
  ClearLedgerResult,
  ImportLedgerResult,
} from "./usePersistentLedgerTypes";
import {
  INITIAL_PERSISTENCE_VERSION_STATE,
  isSamePersistenceTarget,
} from "./usePersistentLedgerHelpers";
import {
  doClearLedger,
  doDrainForSessionQuiesce,
  doStopForImportRecoveryFatal,
  runHydrationEffect,
  runPersistenceTargetEffect,
} from "./usePersistentLedgerLifecycle";
import {
  doEnqueuePersistence,
  doRegisterAcceptedPersistence,
  doRetryPersistence,
  runAutomaticPersistenceEffect,
} from "./usePersistentLedgerPersistence";
import {
  doApplyLedgerAction,
  doApplyLedgerMutation,
} from "./usePersistentLedgerActions";
import { doReplaceLedgerFromBackup } from "./usePersistentLedgerImport";
import {
  doDiscardDirtyChangesAndSwitchRepository,
  doTrackSessionAcceptedWork,
  runHydrationCompletionEffect,
} from "./usePersistentLedgerSession";
import {
  runClockRefreshEffect,
  runLeaveWarningEffect,
} from "./usePersistentLedgerBrowserEffects";

/**
 * 这个 hook 管一本账从打开到关掉的全部存取。
 * 它先把账本从仓库读进来，读好之前页面不能改账。
 * 读好后，每次改账都排进存盘队。
 * 它返回一整包：当前账本，改账入口，存盘状态，清空和导入。
 * 读失败、存失败都不抛错，放在返回的状态和提示文字里。
 * 提示文字和兼容提醒按当前界面语言给。
 * 传了会话时，存盘走会话给的通道；通道没接上就去存，会抛错。
 */
export function usePersistentLedger(
  requestedRepository: LedgerRepository,
  clock: LedgerClock = systemLedgerClock,
  capabilities: LedgerSessionCapabilities =
    LEDGER_FILE_READY_IMPORT_CAPABILITIES,
  requestedSession?: LedgerSession,
): PersistentLedgerState {
  const [ledgerData, reducerDispatch] = useReducer(
    ledgerReducer,
    undefined,
    createInitialLedgerData,
  );
  const [hydrationStatus, setHydrationStatus] =
    useState<HydrationStatus>("loading");
  // 为什么提示存翻译键、返回时才翻：用户换语言后，已经显示的提示也跟着换。
  // `t` 只进兼容提醒、导入回调和返回值，不进任何 effect，免得换语言就重读账本。
  // 2026-11-15 定（W26 04B 第三节第 1 条第 1 点、复审后修订第 5 条）。
  const { t } = useLanguage();
  const [persistenceErrorKey, setPersistenceError] = useState<TranslationKey | null>(null);
  const [resourcePolicyError, setResourcePolicyError] =
    useState<LedgerResourcePolicyError | null>(null);
  const [isReadOnly, setIsReadOnly] = useState(false);
  const [persistenceOperation, setPersistenceOperation] =
    useState<PersistenceOperation>("idle");
  const [persistenceVersionState, setPersistenceVersionState] =
    useState<PersistenceVersionState>(INITIAL_PERSISTENCE_VERSION_STATE);
  const [ledgerEpoch, setLedgerEpoch] = useState(0);
  const [lifecycleStatus, setLifecycleStatus] =
    useState<"active" | "quiescing">("active");
  const [sessionFatalSignal, setSessionFatalSignal] =
    useState<LedgerSessionFatalSignal | null>(null);
  const [, requestClockRefresh] = useReducer((version: number) => version + 1, 0);
  const [repositorySwitchRequestVersion, requestRepositorySwitchRender] =
    useState(0);
  const mountedRef = useRef(true);
  const sessionPersistenceOwnerRef = useRef<object>({});
  const sessionPersistenceBindingsRef = useRef(
    new WeakMap<LedgerSession, SessionPersistenceBinding>(),
  );
  const sessionPersistenceRepository = useMemo<LedgerRepository | null>(() => {
    if (!requestedSession) {
      return null;
    }

    const requireCommittedPersistenceRepository = (): LedgerRepository => {
      const binding =
        sessionPersistenceBindingsRef.current.get(requestedSession);
      if (!binding) {
        throw new Error(
          "The LedgerSession persistence port has not been committed",
        );
      }
      return binding.port.repository;
    };

    return Object.freeze({
      load: () => requireCommittedPersistenceRepository().load(),
      save: (ledgerData: LedgerData) =>
        requireCommittedPersistenceRepository().save(ledgerData),
      saveAfterAction: (
        action: LedgerAction,
        ledgerData: LedgerData,
      ) => {
        const repository = requireCommittedPersistenceRepository();
        return repository.saveAfterAction
          ? repository.saveAfterAction(action, ledgerData)
          : repository.save(ledgerData);
      },
      clear: () => requireCommittedPersistenceRepository().clear(),
    });
  }, [requestedSession]);
  const requestedPersistenceRepository =
    sessionPersistenceRepository ?? requestedRepository;
  const requestedPersistenceTarget = useMemo<PersistenceTarget>(
    () => ({
      repository: requestedPersistenceRepository,
      session: requestedSession,
    }),
    [requestedPersistenceRepository, requestedSession],
  );
  const [activePersistenceTarget, setActivePersistenceTarget] =
    useState<PersistenceTarget>(requestedPersistenceTarget);
  const activePersistenceTargetRef = useRef(activePersistenceTarget);
  const repositorySwitchPermissionRef = useRef<LedgerRepository | null>(null);
  const currentRepositoryRef = useRef(activePersistenceTarget.repository);
  const ledgerDataRef = useRef(ledgerData);
  const generationRef = useRef(0);
  const persistenceVersionStateRef =
    useRef<PersistenceVersionState>(INITIAL_PERSISTENCE_VERSION_STATE);
  const lastPersistedSnapshotRef = useRef<string | null>(null);
  const latestScheduledSnapshotRef = useRef<ScheduledSnapshot | null>(null);
  const failedSnapshotRef = useRef<ScheduledSnapshot | null>(null);
  const retryAttemptRef = useRef<RetryAttempt | null>(null);
  const writeQueueRef = useRef<Promise<void>>(Promise.resolve());
  const hydratedRepositoryRef = useRef<LedgerRepository | null>(null);
  const hydrationErrorRepositoryRef = useRef<LedgerRepository | null>(null);
  const operationRef = useRef<PersistenceOperation>("idle");
  const operationRepositoryRef = useRef<LedgerRepository | null>(null);
  const operationTokenRef = useRef<symbol | null>(null);
  const clearPromiseRef = useRef<Promise<ClearLedgerResult> | null>(null);
  const importPromiseRef = useRef<Promise<ImportLedgerResult> | null>(null);
  const importAbortControllerRef = useRef<AbortController | null>(
    null,
  );
  const importSessionRef = useRef<LedgerSession | undefined>(
    undefined,
  );
  const hydrationPromisesRef =
    useRef<Set<Promise<void>>>(new Set());
  const pendingHydrationRef = useRef<{
    repository: LedgerRepository;
    generation: number;
    serializedLedger: string;
  } | null>(null);
  const readOnlyRef = useRef(false);
  const acceptingOperationsRef = useRef(true);
  const sessionFatalSignalRef = useRef<LedgerSessionFatalSignal | null>(null);
  const fatalOccurrenceRef = useRef(0);

  useLayoutEffect(() =>
    runPersistenceTargetEffect({
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
    }), [
    activePersistenceTarget,
    persistenceOperation,
    persistenceVersionState.mutationVersion,
    persistenceVersionState.persistedVersion,
    repositorySwitchRequestVersion,
    requestedPersistenceRepository,
    requestedPersistenceTarget,
    requestedSession,
  ]);

  const trackSessionAcceptedWork = useCallback(
    (
      session: LedgerSession | undefined,
      work: PromiseLike<unknown>,
    ): void => {
      return doTrackSessionAcceptedWork(
        {
          sessionPersistenceBindingsRef,
        },
        session,
        work,
      );
    },
    [],
  );

  const currentVersionState = persistenceVersionStateRef.current;
  const isCurrentlyDirty =
    currentVersionState.persistedVersion !== currentVersionState.mutationVersion;

  const activeRepository = activePersistenceTarget.repository;
  const activeSession = activePersistenceTarget.session;
  const activeCapabilities =
    activeSession?.capabilities ?? capabilities;
  const persistenceTargetChanged = !isSamePersistenceTarget(
    activeRepository,
    activeSession,
    requestedPersistenceRepository,
    requestedSession,
  );
  const repositorySwitchBlocked =
    persistenceTargetChanged &&
    (isCurrentlyDirty || operationRef.current === "importing");
  const isDirty =
    persistenceVersionState.persistedVersion !==
    persistenceVersionState.mutationVersion;
  const renderTimeSnapshot = captureLedgerTime(clock);
  const todayKey = renderTimeSnapshot.todayKey;
  const midnightDelay = millisecondsUntilNextLocalMidnight(
    renderTimeSnapshot.now,
  );
  const compatibilityWarnings = useMemo(
    () => collectLedgerCompatibilityWarnings(ledgerData, todayKey, t),
    [ledgerData, todayKey, t],
  );
  const factPartition = useMemo(
    () => partitionLedgerFactsForToday(ledgerData, todayKey),
    [ledgerData, todayKey],
  );
  const isFutureFactCorrectionMode =
    factPartition.futureTrades.length > 0 ||
    factPartition.futureCashEvents.length > 0 ||
    factPartition.futureAssetTransfers.length > 0 ||
    factPartition.futurePriceSnapshots.length > 0;

  const publishPersistenceVersionState = useCallback(
    (nextState: PersistenceVersionState) => {
      persistenceVersionStateRef.current = nextState;

      if (mountedRef.current) {
        setPersistenceVersionState(nextState);
      }
    },
    [],
  );

  const enqueuePersistence = useCallback(
    (
      scheduledSnapshot: ScheduledSnapshot,
      ledgerSnapshot: LedgerData,
      scheduledRepository: LedgerRepository,
      scheduledSession: LedgerSession | undefined,
    ): Promise<PersistenceAttemptResult> =>
      doEnqueuePersistence(
        {
          currentRepositoryRef,
          failedSnapshotRef,
          generationRef,
          hydratedRepositoryRef,
          lastPersistedSnapshotRef,
          latestScheduledSnapshotRef,
          mountedRef,
          persistenceVersionStateRef,
          publishPersistenceVersionState,
          setPersistenceError,
          trackSessionAcceptedWork,
          writeQueueRef,
        },
        scheduledSnapshot,
        ledgerSnapshot,
        scheduledRepository,
        scheduledSession,
      ),
    [publishPersistenceVersionState, trackSessionAcceptedWork],
  );

  const registerAcceptedPersistence = useCallback(
    (
      ledgerSnapshot: LedgerData,
      nextVersionState: PersistenceVersionState,
      scheduledRepository: LedgerRepository,
      scheduledSession: LedgerSession | undefined,
      action?: LedgerAction,
    ): void =>
      doRegisterAcceptedPersistence(
        {
          enqueuePersistence,
          generationRef,
          lastPersistedSnapshotRef,
          publishPersistenceVersionState,
        },
        ledgerSnapshot,
        nextVersionState,
        scheduledRepository,
        scheduledSession,
        action,
      ),
    [
      enqueuePersistence,
      publishPersistenceVersionState,
    ],
  );

  useEffect(() => {
    mountedRef.current = true;

    return () => {
      mountedRef.current = false;
      acceptingOperationsRef.current = false;
      // 为什么读 `.current` 而不是挂载时那个：要停掉的是此刻正在跑的导入。
      // 2026-09-02 提交 41630e6 写下这个理由。
      // eslint-disable-next-line react-hooks/exhaustive-deps -- 卸载时要取消此刻那次导入，不是挂载时的
      importAbortControllerRef.current?.abort();
      generationRef.current += 1;
      failedSnapshotRef.current = null;
      retryAttemptRef.current = null;
    };
  }, []);

  useEffect(() => {
    return runClockRefreshEffect(
      {
        midnightDelay,
        requestClockRefresh,
      },
    );
  }, [clock, midnightDelay, todayKey]);

  useEffect(() => {
    return runLeaveWarningEffect(
      {
        isDirty,
      },
    );
  }, [isDirty]);

  useEffect(() =>
    runHydrationEffect({
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
    }), [
    activePersistenceTarget,
    activeRepository,
    activeSession,
    publishPersistenceVersionState,
    trackSessionAcceptedWork,
  ]);

  useEffect(() => {
    return runHydrationCompletionEffect(
      {
        activeRepository,
        generationRef,
        hydratedRepositoryRef,
        hydrationStatus,
        ledgerData,
        pendingHydrationRef,
        setHydrationStatus,
        setLedgerEpoch,
      },
    );
  }, [activeRepository, hydrationStatus, ledgerData]);

  useEffect(() =>
    runAutomaticPersistenceEffect({
      acceptingOperationsRef,
      activeRepository,
      activeSession,
      enqueuePersistence,
      failedSnapshotRef,
      generationRef,
      hydratedRepositoryRef,
      hydrationStatus,
      lastPersistedSnapshotRef,
      latestScheduledSnapshotRef,
      ledgerData,
      operationRef,
      persistenceVersionStateRef,
      publishPersistenceVersionState,
      readOnlyRef,
    }), [
    enqueuePersistence,
    hydrationStatus,
    ledgerData,
    persistenceOperation,
    persistenceVersionState.mutationVersion,
    publishPersistenceVersionState,
    activeRepository,
    activeSession,
  ]);

  const applyLedgerAction = useCallback(
    (
      action: LedgerAction,
      timeSnapshot?: LedgerTimeSnapshot,
    ): ApplyLedgerActionResult =>
      doApplyLedgerAction(
        {
          acceptingOperationsRef,
          activeRepository,
          activeSession,
          clock,
          failedSnapshotRef,
          hydratedRepositoryRef,
          hydrationStatus,
          isFutureFactCorrectionMode,
          ledgerDataRef,
          mountedRef,
          operationRef,
          persistenceVersionStateRef,
          readOnlyRef,
          reducerDispatch,
          registerAcceptedPersistence,
          retryAttemptRef,
          setPersistenceError,
          setResourcePolicyError,
        },
        action,
        timeSnapshot,
      ),
    [
      activeRepository,
      activeSession,
      clock,
      hydrationStatus,
      isFutureFactCorrectionMode,
      registerAcceptedPersistence,
    ],
  );

  const applyLedgerMutation = useCallback(
    (
      mutation: (current: LedgerData) => LedgerData,
      timeSnapshot?: LedgerTimeSnapshot,
    ): ApplyLedgerActionResult =>
      doApplyLedgerMutation(
        {
          acceptingOperationsRef,
          activeRepository,
          activeSession,
          clock,
          failedSnapshotRef,
          hydratedRepositoryRef,
          hydrationStatus,
          ledgerDataRef,
          mountedRef,
          operationRef,
          persistenceVersionStateRef,
          readOnlyRef,
          reducerDispatch,
          registerAcceptedPersistence,
          retryAttemptRef,
          setPersistenceError,
          setResourcePolicyError,
        },
        mutation,
        timeSnapshot,
      ),
    [
      activeRepository,
      activeSession,
      clock,
      hydrationStatus,
      registerAcceptedPersistence,
    ],
  );

  const retryPersistence = useCallback(
    (): Promise<boolean> =>
      doRetryPersistence({
        acceptingOperationsRef,
        activeRepository,
        activeSession,
        enqueuePersistence,
        failedSnapshotRef,
        generationRef,
        hydratedRepositoryRef,
        hydrationStatus,
        ledgerDataRef,
        mountedRef,
        operationRef,
        persistenceVersionStateRef,
        publishPersistenceVersionState,
        readOnlyRef,
        retryAttemptRef,
        setPersistenceError,
      }),
    [
    enqueuePersistence,
    hydrationStatus,
    publishPersistenceVersionState,
    activeRepository,
    activeSession,
  ],
  );

  const discardDirtyChangesAndSwitchRepository = useCallback((): boolean => {
    return doDiscardDirtyChangesAndSwitchRepository(
      {
        acceptingOperationsRef,
        activePersistenceTargetRef,
        failedSnapshotRef,
        operationRef,
        persistenceVersionStateRef,
        repositorySwitchPermissionRef,
        requestRepositorySwitchRender,
        requestedPersistenceRepository,
        requestedSession,
        retryAttemptRef,
      },
    );
  }, [requestedPersistenceRepository, requestedSession]);

  const clearLedger = useCallback(
    (
      confirmationNonce = "",
    ): Promise<ClearLedgerResult> =>
      doClearLedger(
        {
          acceptingOperationsRef,
          activeCapabilities: {
            canClearReadyLedger: activeCapabilities.canClearReadyLedger,
          },
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
        },
        confirmationNonce,
      ),
    [
    activeRepository,
    activeSession,
    activeCapabilities.canClearReadyLedger,
    hydrationStatus,
    publishPersistenceVersionState,
    trackSessionAcceptedWork,
  ],
  );

  const stopForImportRecoveryFatal = useCallback(
    (message: TranslationKey): void =>
      doStopForImportRecoveryFatal(
        {
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
        },
        message,
      ),
    [publishPersistenceVersionState],
  );

  const replaceLedgerFromBackup = useCallback(
    (
      candidate: unknown,
      timeSnapshot?: LedgerTimeSnapshot,
      evidence?: LedgerBackupImportEvidence,
      externalSignal?: AbortSignal,
    ): Promise<ImportLedgerResult> =>
      doReplaceLedgerFromBackup(
        {
          acceptingOperationsRef,
          activeCapabilities: {
            canImportBackup: activeCapabilities.canImportBackup,
          },
          activeRepository,
          activeSession,
          clock,
          currentRepositoryRef,
          failedSnapshotRef,
          generationRef,
          hydratedRepositoryRef,
          hydrationErrorRepositoryRef,
          hydrationStatus,
          importAbortControllerRef,
          importPromiseRef,
          importSessionRef,
          lastPersistedSnapshotRef,
          latestScheduledSnapshotRef,
          ledgerDataRef,
          mountedRef,
          operationRef,
          operationRepositoryRef,
          operationTokenRef,
          pendingHydrationRef,
          persistenceVersionStateRef,
          publishPersistenceVersionState,
          readOnlyRef,
          reducerDispatch,
          retryAttemptRef,
          setHydrationStatus,
          setIsReadOnly,
          setLedgerEpoch,
          setPersistenceError,
          setPersistenceOperation,
          setResourcePolicyError,
          stopForImportRecoveryFatal,
          t,
          trackSessionAcceptedWork,
          writeQueueRef,
        },
        candidate,
        timeSnapshot,
        evidence,
        externalSignal,
      ),
    [
      activeRepository,
      activeSession,
      activeCapabilities.canImportBackup,
      clock,
      hydrationStatus,
      publishPersistenceVersionState,
      stopForImportRecoveryFatal,
      t,
      trackSessionAcceptedWork,
    ],
  );

  const drainForSessionQuiesce = useCallback(
    (
      request: SessionQuiesceRequest,
    ): Promise<SessionQuiesceToken> =>
      doDrainForSessionQuiesce(
        {
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
        },
        request,
      ),
    [requestedSession],
  );

  return {
    ledgerData,
    applyLedgerAction,
    applyLedgerMutation,
    hydrationStatus,
    persistenceError: persistenceErrorKey === null ? null : t(persistenceErrorKey),
    resourcePolicyError,
    isReadOnly,
    retryPersistence,
    canRetryPersistence:
      persistenceVersionState.persistenceStatus === "error" &&
      failedSnapshotRef.current?.generation === generationRef.current &&
      failedSnapshotRef.current.version ===
        persistenceVersionState.mutationVersion,
    clearLedger,
    replaceLedgerFromBackup,
    persistenceOperation,
    persistenceStatus: persistenceVersionState.persistenceStatus,
    mutationVersion: persistenceVersionState.mutationVersion,
    persistedVersion: persistenceVersionState.persistedVersion,
    isDirty,
    repositorySwitchBlocked,
    discardDirtyChangesAndSwitchRepository,
    ledgerEpoch,
    compatibilityWarnings,
    isFutureFactCorrectionMode,
    todayKey,
    lifecycleStatus,
    sessionFatalSignal,
    drainForSessionQuiesce,
  };
}
