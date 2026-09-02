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
import { validateLedgerImportPolicy } from "@/core/policies";
import {
  assertSessionQuiesceRequest,
  claimLedgerSessionPersistencePort,
  LEDGER_REPOSITORY_ERROR_CODES,
  INDEXED_DB_LEDGER_CAPABILITIES,
  type LedgerBackupImportEvidence,
  type LedgerSession,
  type LedgerSessionCapabilities,
  type LedgerRepository,
  type SessionQuiesceRequest,
  type SessionQuiesceToken,
} from "@/platform/persistence";
import {
  LEDGER_FILE_REPOSITORY_ERROR_CODES,
  LedgerFileRepositoryError,
} from "@/platform/files";
import { createInitialLedgerData } from "@/core/state";
import type { HydrationStatus } from "./hydrationState";
import {
  ledgerReducer,
  type LedgerAction,
} from "@/core/state";
import {
  evaluateLedgerResourcePolicy,
  evaluateLedgerResourcePolicyAfterTradeAppend,
  type LedgerResourcePolicyError,
} from "@/core/validation";
import { validateLedgerData } from "@/core/validation";
import {
  captureLedgerTime,
  millisecondsUntilNextLocalMidnight,
  systemLedgerClock,
  type LedgerClock,
  type LedgerTimeSnapshot,
} from "@/core/shared";
import { translateDefault } from "@/ui";
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
  invokeRepositorySave,
  invokeRepositoryActionSave,
  isSamePersistenceTarget,
  isLedgerFileBackedRepository,
  hasFutureFacts,
  isCorrectionAction,
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

export type {
  ApplyLedgerActionResult,
  ClearLedgerResult,
  ImportLedgerResult,
  LedgerSessionFatalSignal,
  PersistenceOperation,
  PersistenceStatus,
  PersistentLedgerState,
} from "./usePersistentLedgerTypes";

/**
 * 统一管理启动读取、hydration 门禁和 ready 后的串行自动保存。
 */
export function usePersistentLedger(
  requestedRepository: LedgerRepository,
  clock: LedgerClock = systemLedgerClock,
  capabilities: LedgerSessionCapabilities =
    INDEXED_DB_LEDGER_CAPABILITIES,
  requestedSession?: LedgerSession,
): PersistentLedgerState {
  const [ledgerData, reducerDispatch] = useReducer(
    ledgerReducer,
    undefined,
    createInitialLedgerData,
  );
  const [hydrationStatus, setHydrationStatus] =
    useState<HydrationStatus>("loading");
  const [persistenceError, setPersistenceError] = useState<string | null>(null);
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
      if (!session) {
        return;
      }
      const binding = sessionPersistenceBindingsRef.current.get(session);
      if (!binding) {
        throw new Error(
          "The LedgerSession persistence port has not been committed",
        );
      }
      binding.acceptedWork.add(work);
      void Promise.resolve(work)
        .finally(() => {
          binding.acceptedWork.delete(work);
        })
        .catch(() => undefined);
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
    () => collectLedgerCompatibilityWarnings(ledgerData, todayKey),
    [ledgerData, todayKey],
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
      importAbortControllerRef.current?.abort();
      generationRef.current += 1;
      failedSnapshotRef.current = null;
      retryAttemptRef.current = null;
    };
  }, []);

  useEffect(() => {
    const refreshClock = () => requestClockRefresh();
    const refreshWhenVisible = () => {
      if (document.visibilityState === "visible") {
        refreshClock();
      }
    };
    const midnightTimer = window.setTimeout(
      refreshClock,
      midnightDelay,
    );

    window.addEventListener("focus", refreshClock);
    document.addEventListener("visibilitychange", refreshWhenVisible);
    return () => {
      window.clearTimeout(midnightTimer);
      window.removeEventListener("focus", refreshClock);
      document.removeEventListener("visibilitychange", refreshWhenVisible);
    };
  }, [clock, midnightDelay, todayKey]);

  useEffect(() => {
    if (!isDirty) {
      return;
    }

    function warnBeforeUnload(event: BeforeUnloadEvent) {
      event.preventDefault();
      event.returnValue = "";
    }

    window.addEventListener("beforeunload", warnBeforeUnload);
    return () => {
      window.removeEventListener("beforeunload", warnBeforeUnload);
    };
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
    const pendingHydration = pendingHydrationRef.current;

    if (
      hydrationStatus !== "loading" ||
      pendingHydration === null ||
      pendingHydration.repository !== activeRepository ||
      pendingHydration.generation !== generationRef.current ||
      JSON.stringify(ledgerData) !== pendingHydration.serializedLedger
    ) {
      return;
    }

    pendingHydrationRef.current = null;
    hydratedRepositoryRef.current = activeRepository;
    setLedgerEpoch((current) => current + 1);
    setHydrationStatus("ready");
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
    const versionState = persistenceVersionStateRef.current;

    if (
      !acceptingOperationsRef.current ||
      operationRef.current !== "idle" ||
      isSamePersistenceTarget(
        activePersistenceTargetRef.current.repository,
        activePersistenceTargetRef.current.session,
        requestedPersistenceRepository,
        requestedSession,
      ) ||
      versionState.persistedVersion === versionState.mutationVersion
    ) {
      return false;
    }

    repositorySwitchPermissionRef.current =
      requestedPersistenceRepository;
    failedSnapshotRef.current = null;
    retryAttemptRef.current = null;
    requestRepositorySwitchRender((current) => current + 1);
    return true;
  }, [requestedPersistenceRepository, requestedSession]);

  const clearLedger = useCallback(
    (
      confirmationNonce = "",
    ): Promise<ClearLedgerResult> =>
      doClearLedger(
        {
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
        },
        confirmationNonce,
      ),
    [
    activeRepository,
    activeSession,
    activeCapabilities.canClearHydrationError,
    activeCapabilities.canClearReadyLedger,
    hydrationStatus,
    publishPersistenceVersionState,
    trackSessionAcceptedWork,
  ],
  );

  const stopForImportRecoveryFatal = useCallback(
    (message: string): void =>
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
          activeCapabilities,
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
    persistenceError,
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
