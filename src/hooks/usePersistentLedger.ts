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

import type { LedgerData } from "../models";
import {
  collectLedgerCompatibilityWarnings,
  normalizeLedgerDataForRuntime,
  partitionLedgerFactsForToday,
  type LedgerCompatibilityWarning,
} from "../policies/ledgerFactPolicy";
import {
  validateLedgerImportPolicy,
  type LedgerImportPolicyError,
} from "../policies/ledgerImportPolicy";
import {
  assertSessionQuiesceRequest,
  claimLedgerSessionPersistencePort,
  LEDGER_REPOSITORY_ERROR_CODES,
  INDEXED_DB_LEDGER_CAPABILITIES,
  type LedgerBackupImportEvidence,
  type LedgerSession,
  type LedgerSessionCapabilities,
  type LedgerSessionPersistencePort,
  type LedgerRepository,
  type SessionQuiesceRequest,
  type SessionQuiesceToken,
} from "../repositories/ledgerRepository";
import {
  LEDGER_FILE_REPOSITORY_ERROR_CODES,
  LedgerFileRepository,
  LedgerFileRepositoryError,
} from "../repositories/ledgerFileRepository";
import { createInitialLedgerData } from "../state/initialLedgerData";
import type { HydrationStatus } from "../state/hydrationState";
import {
  ledgerReducer,
  type LedgerAction,
} from "../state/ledgerReducer";
import {
  evaluateLedgerResourcePolicy,
  type LedgerResourcePolicyError,
} from "../validators/resourcePolicy";
import { validateLedgerData } from "../validators/ledgerDataValidator";
import {
  captureLedgerTime,
  isLedgerFactInFuture,
  millisecondsUntilNextLocalMidnight,
  systemLedgerClock,
  type LedgerClock,
  type LedgerTimeSnapshot,
} from "../utils/ledgerDate";

export type PersistentLedgerState = {
  ledgerData: LedgerData;
  applyLedgerAction: (
    action: LedgerAction,
    timeSnapshot?: LedgerTimeSnapshot,
  ) => ApplyLedgerActionResult;
  applyLedgerMutation: (
    mutation: (current: LedgerData) => LedgerData,
    timeSnapshot?: LedgerTimeSnapshot,
  ) => ApplyLedgerActionResult;
  hydrationStatus: HydrationStatus;
  persistenceError: string | null;
  resourcePolicyError: LedgerResourcePolicyError | null;
  isReadOnly: boolean;
  retryPersistence: () => Promise<boolean>;
  canRetryPersistence: boolean;
  clearLedger: (
    confirmationNonce?: string,
  ) => Promise<ClearLedgerResult>;
  replaceLedgerFromBackup: (
    candidate: unknown,
    timeSnapshot?: LedgerTimeSnapshot,
    evidence?: LedgerBackupImportEvidence,
    signal?: AbortSignal,
  ) => Promise<ImportLedgerResult>;
  persistenceOperation: PersistenceOperation;
  persistenceStatus: PersistenceStatus;
  mutationVersion: number;
  persistedVersion: number;
  isDirty: boolean;
  repositorySwitchBlocked: boolean;
  discardDirtyChangesAndSwitchRepository: () => boolean;
  ledgerEpoch: number;
  compatibilityWarnings: LedgerCompatibilityWarning[];
  isFutureFactCorrectionMode: boolean;
  todayKey: string;
  lifecycleStatus: "active" | "quiescing";
  drainForSessionQuiesce: (
    request: SessionQuiesceRequest,
  ) => Promise<SessionQuiesceToken>;
};

export type PersistenceOperation = "idle" | "clearing" | "importing";
export type PersistenceStatus = "idle" | "saving" | "saved" | "error";
export type ApplyLedgerActionResult = "applied" | "noop" | "rejected";

type PersistenceVersionState = {
  mutationVersion: number;
  persistedVersion: number;
  persistenceStatus: PersistenceStatus;
};

type ScheduledSnapshot = {
  generation: number;
  version: number;
  serializedLedger: string;
};

type RetryAttempt = {
  generation: number;
  version: number;
  promise: Promise<boolean>;
};

type SessionPersistenceBinding = {
  readonly port: LedgerSessionPersistencePort;
  readonly acceptedWork: Set<PromiseLike<unknown>>;
  quiesceRequest: SessionQuiesceRequest | null;
  quiesceDrain: Promise<SessionQuiesceToken> | null;
};

type PersistenceTarget = Readonly<{
  repository: LedgerRepository;
  session: LedgerSession | undefined;
}>;

type PersistenceAttemptResult = "saved" | "failed" | "ignored";

const INITIAL_PERSISTENCE_VERSION_STATE: PersistenceVersionState = {
  mutationVersion: 0,
  persistedVersion: 0,
  persistenceStatus: "idle",
};

export type ClearLedgerResult =
  | { ok: true }
  | {
      ok: false;
      code: typeof LEDGER_REPOSITORY_ERROR_CODES.CLEAR_FAILED;
    };

export type ImportLedgerResult =
  | { ok: true }
  | {
      ok: false;
      code:
        | "LEDGER_IMPORT_NOT_ALLOWED"
        | "LEDGER_IMPORT_INVALID_BACKUP"
        | "LEDGER_IMPORT_CANCELLED"
        | "LEDGER_IMPORT_BASE_RESTORED"
        | "LEDGER_IMPORT_SOURCE_CHANGED"
        | "LEDGER_IMPORT_RECOVERY_BLOCKED"
        | typeof LEDGER_REPOSITORY_ERROR_CODES.WRITE_FAILED;
      errors?: LedgerImportPolicyError[];
    };

/**
 * Coordinates startup loading, the hydration gate, and serialized autosave after ready.
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

  useLayoutEffect(() => {
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
  }, [
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
  const compatibilityWarnings = collectLedgerCompatibilityWarnings(
    ledgerData,
    todayKey,
  );
  const factPartition = partitionLedgerFactsForToday(ledgerData, todayKey);
  const isFutureFactCorrectionMode =
    factPartition.futureTrades.length > 0 ||
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
    ): Promise<PersistenceAttemptResult> => {
      latestScheduledSnapshotRef.current = scheduledSnapshot;
      const usesLatestFileSave =
        isLedgerFileBackedRepository(
          scheduledRepository,
          scheduledSession,
        );
      const precedingQueue = writeQueueRef.current.catch(
        () => undefined,
      );
      const saveAttempt = usesLatestFileSave
        ? invokeRepositorySave(scheduledRepository, ledgerSnapshot)
        : precedingQueue.then(() =>
            scheduledRepository.save(ledgerSnapshot),
          );

      const persistenceAttempt = saveAttempt
        .then((): PersistenceAttemptResult => {
          if (
            currentRepositoryRef.current !== scheduledRepository ||
            hydratedRepositoryRef.current !== scheduledRepository ||
            generationRef.current !== scheduledSnapshot.generation
          ) {
            return "ignored";
          }

          const currentVersionState =
            persistenceVersionStateRef.current;
          if (
            usesLatestFileSave &&
            scheduledSnapshot.version <
              currentVersionState.mutationVersion
          ) {
            return "ignored";
          }

          lastPersistedSnapshotRef.current =
            scheduledSnapshot.serializedLedger;

          if (
            latestScheduledSnapshotRef.current === scheduledSnapshot
          ) {
            latestScheduledSnapshotRef.current = null;
          }

          if (
            failedSnapshotRef.current?.generation ===
              scheduledSnapshot.generation &&
            failedSnapshotRef.current.version === scheduledSnapshot.version
          ) {
            failedSnapshotRef.current = null;
          }

          const nextPersistedVersion = Math.max(
            currentVersionState.persistedVersion,
            scheduledSnapshot.version,
          );
          publishPersistenceVersionState({
            ...currentVersionState,
            persistedVersion: nextPersistedVersion,
            persistenceStatus:
              nextPersistedVersion === currentVersionState.mutationVersion
                ? "saved"
                : "saving",
          });

          if (
            mountedRef.current &&
            nextPersistedVersion === currentVersionState.mutationVersion
          ) {
            setPersistenceError(null);
          }

          return "saved";
        })
        .catch((error: unknown): PersistenceAttemptResult => {
          if (
            currentRepositoryRef.current !== scheduledRepository ||
            hydratedRepositoryRef.current !== scheduledRepository ||
            generationRef.current !== scheduledSnapshot.generation
          ) {
            return "ignored";
          }

          const currentVersionState =
            persistenceVersionStateRef.current;
          if (
            usesLatestFileSave &&
            scheduledSnapshot.version <
              currentVersionState.mutationVersion
          ) {
            return "ignored";
          }

          if (
            latestScheduledSnapshotRef.current === scheduledSnapshot
          ) {
            latestScheduledSnapshotRef.current = null;
          }

          const requiresReopen =
            error instanceof LedgerFileRepositoryError &&
            error.code ===
              LEDGER_FILE_REPOSITORY_ERROR_CODES.EXTERNAL_CHANGE;

          if (
            currentVersionState.mutationVersion === scheduledSnapshot.version
          ) {
            failedSnapshotRef.current = requiresReopen
              ? null
              : scheduledSnapshot;
            publishPersistenceVersionState({
              ...currentVersionState,
              persistenceStatus: "error",
            });
          }

          if (
            mountedRef.current &&
            currentVersionState.mutationVersion === scheduledSnapshot.version
          ) {
            setPersistenceError(
              requiresReopen
                ? "C changed outside this page. The current changes are unsaved; reopen C to avoid overwriting the newer version."
                : "Local save failed and the page data is unsaved. Refreshing will restore the last successfully saved version.",
            );
          }

          return "failed";
        });

      writeQueueRef.current = usesLatestFileSave
        ? Promise.all([precedingQueue, persistenceAttempt]).then(
            () => undefined,
          )
        : persistenceAttempt.then(() => undefined);
      trackSessionAcceptedWork(scheduledSession, persistenceAttempt);
      return persistenceAttempt;
    },
    [publishPersistenceVersionState, trackSessionAcceptedWork],
  );

  const registerAcceptedPersistence = useCallback(
    (
      ledgerSnapshot: LedgerData,
      nextVersionState: PersistenceVersionState,
      scheduledRepository: LedgerRepository,
      scheduledSession: LedgerSession | undefined,
    ): void => {
      const serializedLedger = JSON.stringify(ledgerSnapshot);
      const requiresRepositoryNoOpVerification =
        isLedgerFileBackedRepository(
          scheduledRepository,
          scheduledSession,
        );
      if (
        !requiresRepositoryNoOpVerification &&
        serializedLedger === lastPersistedSnapshotRef.current
      ) {
        publishPersistenceVersionState({
          ...nextVersionState,
          persistedVersion: nextVersionState.mutationVersion,
          persistenceStatus: "saved",
        });
        return;
      }

      publishPersistenceVersionState(nextVersionState);
      const scheduledSnapshot: ScheduledSnapshot = {
        generation: generationRef.current,
        version: nextVersionState.mutationVersion,
        serializedLedger,
      };
      void enqueuePersistence(
        scheduledSnapshot,
        ledgerSnapshot,
        scheduledRepository,
        scheduledSession,
      );
    },
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

  useEffect(() => {
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

        const hydratedLedger = normalizeLedgerDataForRuntime(
          savedLedger ?? createInitialLedgerData(),
        );
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
          "Local ledger loading failed. Autosave was stopped to avoid overwriting the original data.",
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
  }, [
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

  useEffect(() => {
    if (
      !acceptingOperationsRef.current ||
      hydrationStatus !== "ready" ||
      readOnlyRef.current ||
      operationRef.current !== "idle" ||
      hydratedRepositoryRef.current !== activeRepository
    ) {
      return;
    }

    const serialized = JSON.stringify(ledgerData);
    const { mutationVersion, persistedVersion } =
      persistenceVersionStateRef.current;
    const generation = generationRef.current;
    const latestScheduledSnapshot =
      latestScheduledSnapshotRef.current;
    const requiresRepositoryNoOpVerification =
      isLedgerFileBackedRepository(
        activeRepository,
        activeSession,
      );

    if (mutationVersion === persistedVersion) {
      return;
    }

    if (
      serialized === lastPersistedSnapshotRef.current &&
      latestScheduledSnapshot?.generation !== generation &&
      !requiresRepositoryNoOpVerification
    ) {
      publishPersistenceVersionState({
        mutationVersion,
        persistedVersion: mutationVersion,
        persistenceStatus: "saved",
      });
      return;
    }

    if (
      latestScheduledSnapshot?.generation === generation &&
      latestScheduledSnapshot.version === mutationVersion
    ) {
      return;
    }

    const failedSnapshot = failedSnapshotRef.current;

    // A failed version is retried only by the explicit retry action or a new mutation.
    // Re-rendering after an unrelated failed import must not enqueue it again.
    if (
      failedSnapshot?.generation === generation &&
      failedSnapshot.version === mutationVersion
    ) {
      return;
    }

    const scheduledSnapshot: ScheduledSnapshot = {
      generation,
      version: mutationVersion,
      serializedLedger: serialized,
    };
    const ledgerSnapshot = ledgerData;
    const scheduledRepository = activeRepository;

    void enqueuePersistence(
      scheduledSnapshot,
      ledgerSnapshot,
      scheduledRepository,
      activeSession,
    );
  }, [
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
    ): ApplyLedgerActionResult => {
      if (
        !acceptingOperationsRef.current ||
        hydrationStatus !== "ready" ||
        readOnlyRef.current ||
        operationRef.current !== "idle" ||
        hydratedRepositoryRef.current !== activeRepository
      ) {
        return "rejected";
      }

      const currentLedgerData = ledgerDataRef.current;
      const operationTodayKey =
        timeSnapshot?.todayKey ?? captureLedgerTime(clock).todayKey;

      if (
        hasFutureFacts(currentLedgerData, operationTodayKey) &&
        !isCorrectionAction(action, currentLedgerData, operationTodayKey)
      ) {
        return "rejected";
      }

      const nextLedgerData = ledgerReducer(currentLedgerData, action);

      if (nextLedgerData === currentLedgerData) {
        return "noop";
      }

      const resourcePolicyResult =
        evaluateLedgerResourcePolicy(nextLedgerData);

      if (!resourcePolicyResult.ok) {
        if (mountedRef.current) {
          setResourcePolicyError(resourcePolicyResult.errors[0]);
        }
        return "rejected";
      }

      const currentVersionState = persistenceVersionStateRef.current;
      const nextVersionState: PersistenceVersionState = {
        ...currentVersionState,
        mutationVersion: currentVersionState.mutationVersion + 1,
        persistenceStatus: "saving",
      };
      failedSnapshotRef.current = null;
      retryAttemptRef.current = null;
      ledgerDataRef.current = nextLedgerData;
      registerAcceptedPersistence(
        nextLedgerData,
        nextVersionState,
        activeRepository,
        activeSession,
      );

      if (mountedRef.current) {
        setPersistenceError(null);
        setResourcePolicyError(null);
      }

      reducerDispatch({
        type: "ledger/replace",
        ledgerData: nextLedgerData,
      });

      return "applied";
    },
    [
      activeRepository,
      activeSession,
      clock,
      hydrationStatus,
      registerAcceptedPersistence,
    ],
  );

  const applyLedgerMutation = useCallback(
    (
      mutation: (current: LedgerData) => LedgerData,
      timeSnapshot?: LedgerTimeSnapshot,
    ): ApplyLedgerActionResult => {
      if (
        !acceptingOperationsRef.current ||
        hydrationStatus !== "ready" ||
        readOnlyRef.current ||
        operationRef.current !== "idle" ||
        hydratedRepositoryRef.current !== activeRepository
      ) {
        return "rejected";
      }

      const currentLedgerData = ledgerDataRef.current;
      const operationTodayKey =
        timeSnapshot?.todayKey ?? captureLedgerTime(clock).todayKey;
      if (hasFutureFacts(currentLedgerData, operationTodayKey)) {
        return "rejected";
      }

      const nextLedgerData = mutation(currentLedgerData);
      if (nextLedgerData === currentLedgerData) {
        return "noop";
      }

      const resourcePolicyResult =
        evaluateLedgerResourcePolicy(nextLedgerData);
      if (!resourcePolicyResult.ok) {
        if (mountedRef.current) {
          setResourcePolicyError(resourcePolicyResult.errors[0]);
        }
        return "rejected";
      }

      const currentVersionState = persistenceVersionStateRef.current;
      failedSnapshotRef.current = null;
      retryAttemptRef.current = null;
      ledgerDataRef.current = nextLedgerData;
      registerAcceptedPersistence(
        nextLedgerData,
        {
          ...currentVersionState,
          mutationVersion: currentVersionState.mutationVersion + 1,
          persistenceStatus: "saving",
        },
        activeRepository,
        activeSession,
      );

      if (mountedRef.current) {
        setPersistenceError(null);
        setResourcePolicyError(null);
      }
      reducerDispatch({
        type: "ledger/replace",
        ledgerData: nextLedgerData,
      });
      return "applied";
    },
    [
      activeRepository,
      activeSession,
      clock,
      hydrationStatus,
      registerAcceptedPersistence,
    ],
  );

  const retryPersistence = useCallback((): Promise<boolean> => {
    const currentVersionState = persistenceVersionStateRef.current;
    const generation = generationRef.current;
    const currentRetryAttempt = retryAttemptRef.current;

    if (!acceptingOperationsRef.current) {
      return Promise.resolve(false);
    }

    if (
      currentRetryAttempt?.generation === generation &&
      currentRetryAttempt.version === currentVersionState.mutationVersion
    ) {
      return currentRetryAttempt.promise;
    }

    const failedSnapshot = failedSnapshotRef.current;

    if (
      !acceptingOperationsRef.current ||
      hydrationStatus !== "ready" ||
      readOnlyRef.current ||
      operationRef.current !== "idle" ||
      hydratedRepositoryRef.current !== activeRepository ||
      currentVersionState.persistenceStatus !== "error" ||
      failedSnapshot === null ||
      failedSnapshot.generation !== generation ||
      failedSnapshot.version !== currentVersionState.mutationVersion
    ) {
      return Promise.resolve(false);
    }

    const ledgerSnapshot = ledgerDataRef.current;
    const scheduledSnapshot: ScheduledSnapshot = {
      generation,
      version: currentVersionState.mutationVersion,
      serializedLedger: JSON.stringify(ledgerSnapshot),
    };
    publishPersistenceVersionState({
      ...currentVersionState,
      persistenceStatus: "saving",
    });

    if (mountedRef.current) {
      setPersistenceError(null);
    }

    const retryPromise = enqueuePersistence(
      scheduledSnapshot,
      ledgerSnapshot,
      activeRepository,
      activeSession,
    ).then((result) => result === "saved");
    const retryAttempt: RetryAttempt = {
      generation,
      version: currentVersionState.mutationVersion,
      promise: retryPromise,
    };
    retryAttemptRef.current = retryAttempt;
    void retryPromise.finally(() => {
      if (retryAttemptRef.current === retryAttempt) {
        retryAttemptRef.current = null;
      }
    });

    return retryPromise;
  }, [
    enqueuePersistence,
    hydrationStatus,
    publishPersistenceVersionState,
    activeRepository,
    activeSession,
  ]);

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

  const clearLedger = useCallback((
    confirmationNonce = "",
  ): Promise<ClearLedgerResult> => {
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
                    ? "The result of clearing the current C was not confirmed, so the page did not report success. Retry to verify the same clear operation."
                    : "Clearing the current C did not pass safety confirmation, so the file was not written.",
                );
              }
            } else {
              setPersistenceError(
                "Clearing the local ledger failed. The page and local data were not changed.",
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
  }, [
    activeRepository,
    activeSession,
    activeCapabilities.canClearHydrationError,
    activeCapabilities.canClearReadyLedger,
    hydrationStatus,
    publishPersistenceVersionState,
    trackSessionAcceptedWork,
  ]);

  const replaceLedgerFromBackup = useCallback(
    (
      candidate: unknown,
      timeSnapshot?: LedgerTimeSnapshot,
      evidence?: LedgerBackupImportEvidence,
      externalSignal?: AbortSignal,
    ): Promise<ImportLedgerResult> => {
      if (!activeCapabilities.canImportBackup) {
        return Promise.resolve({
          ok: false,
          code: "LEDGER_IMPORT_NOT_ALLOWED",
        });
      }

      if (!acceptingOperationsRef.current) {
        return Promise.resolve({
          ok: false,
          code: "LEDGER_IMPORT_NOT_ALLOWED",
        });
      }

      if (
        operationRef.current === "importing" &&
        operationRepositoryRef.current === activeRepository &&
        importPromiseRef.current !== null
      ) {
        return importPromiseRef.current;
      }

      const currentRetryAttempt = retryAttemptRef.current;
      if (
        currentRetryAttempt?.generation === generationRef.current &&
        currentRetryAttempt.version ===
          persistenceVersionStateRef.current.mutationVersion
      ) {
        return Promise.resolve({ ok: false, code: "LEDGER_IMPORT_NOT_ALLOWED" });
      }

      const canImportReadyLedger =
        hydrationStatus === "ready" &&
        hydratedRepositoryRef.current === activeRepository &&
        !readOnlyRef.current;
      const canRecoverHydrationError =
        hydrationStatus === "error" &&
        hydrationErrorRepositoryRef.current === activeRepository;
      const operationSession = activeSession;
      const isReadyLedgerFileImport =
        operationSession?.storageKind === "ledger-file";
      const versionState = persistenceVersionStateRef.current;
      const hasCleanReadyLedgerFileState =
        canImportReadyLedger &&
        versionState.mutationVersion === versionState.persistedVersion &&
        versionState.persistenceStatus !== "saving" &&
        versionState.persistenceStatus !== "error" &&
        latestScheduledSnapshotRef.current === null &&
        failedSnapshotRef.current === null &&
        retryAttemptRef.current === null &&
        operationSession?.readyImportPort !== null &&
        evidence !== undefined;

      if (
        operationRef.current !== "idle" ||
        (isReadyLedgerFileImport
          ? !hasCleanReadyLedgerFileState
          : !canImportReadyLedger && !canRecoverHydrationError)
      ) {
        return Promise.resolve({ ok: false, code: "LEDGER_IMPORT_NOT_ALLOWED" });
      }

      const ledgerResult = validateLedgerData(candidate);
      if (!ledgerResult.ok || !evaluateLedgerResourcePolicy(ledgerResult.value).ok) {
        return Promise.resolve({ ok: false, code: "LEDGER_IMPORT_INVALID_BACKUP" });
      }
      if (
        isReadyLedgerFileImport &&
        ledgerResult.value.trades.some(
          (trade) =>
            typeof trade.rawText !== "string" ||
            trade.rawText.trim().length === 0,
        )
      ) {
        return Promise.resolve({
          ok: false,
          code: "LEDGER_IMPORT_INVALID_BACKUP",
        });
      }

      const importPolicy = validateLedgerImportPolicy(
        ledgerResult.value,
        timeSnapshot?.todayKey ?? captureLedgerTime(clock).todayKey,
      );
      if (!importPolicy.ok) {
        return Promise.resolve({
          ok: false,
          code: "LEDGER_IMPORT_INVALID_BACKUP",
          errors: importPolicy.errors,
        });
      }

      const normalizedLedger = normalizeLedgerDataForRuntime(
        ledgerResult.value,
      );
      const normalizedValidation =
        validateLedgerData(normalizedLedger);
      if (
        !normalizedValidation.ok ||
        !evaluateLedgerResourcePolicy(normalizedValidation.value).ok
      ) {
        return Promise.resolve({
          ok: false,
          code: "LEDGER_IMPORT_INVALID_BACKUP",
        });
      }
      const validatedLedger = normalizedValidation.value;
      const serializedCandidate = JSON.stringify(validatedLedger);
      const authorizedCandidateIdentity =
        evidence?.candidateIdentity ?? serializedCandidate;
      const operationToken = Symbol("import-ledger");
      const operationRepository = activeRepository;
      const hookGeneration = generationRef.current;
      const precedingQueue = writeQueueRef.current.catch(
        () => undefined,
      );
      const importController = new AbortController();
      const abortFromCaller = () =>
        importController.abort(externalSignal?.reason);
      if (externalSignal?.aborted) {
        abortFromCaller();
      } else {
        externalSignal?.addEventListener("abort", abortFromCaller, {
          once: true,
        });
      }
      operationRef.current = "importing";
      operationRepositoryRef.current = operationRepository;
      operationTokenRef.current = operationToken;
      importAbortControllerRef.current = importController;
      importSessionRef.current = operationSession;

      if (mountedRef.current) {
        setPersistenceOperation("importing");
      }

      let resolveImport!: (result: ImportLedgerResult) => void;
      const registeredImport = new Promise<ImportLedgerResult>(
        (resolve) => {
          resolveImport = resolve;
        },
      );
      const importPromise = registeredImport
        .finally(() => {
          externalSignal?.removeEventListener(
            "abort",
            abortFromCaller,
          );
          if (
            operationTokenRef.current !== operationToken ||
            currentRepositoryRef.current !== operationRepository
          ) {
            return;
          }

          operationRef.current = "idle";
          operationRepositoryRef.current = null;
          operationTokenRef.current = null;
          importPromiseRef.current = null;
          if (
            importAbortControllerRef.current === importController
          ) {
            importAbortControllerRef.current = null;
            importSessionRef.current = undefined;
          }

          if (mountedRef.current) {
            setPersistenceOperation("idle");
          }
        });

      importPromiseRef.current = importPromise;
      writeQueueRef.current = Promise.all([
        precedingQueue,
        importPromise,
      ]).then(() => undefined);
      trackSessionAcceptedWork(operationSession, importPromise);

      const executeImport = async (): Promise<ImportLedgerResult> => {
        if (importController.signal.aborted) {
          return { ok: false, code: "LEDGER_IMPORT_CANCELLED" };
        }

        let verifiedLedger = validatedLedger;
        if (isReadyLedgerFileImport) {
          const importPort = operationSession?.readyImportPort;
          if (!importPort || !evidence) {
            return {
              ok: false,
              code: "LEDGER_IMPORT_NOT_ALLOWED",
            };
          }
          const authorization = importPort.authorizeReadyImport(
            evidence,
            hookGeneration,
            authorizedCandidateIdentity,
          );
          if (!authorization) {
            return {
              ok: false,
              code: "LEDGER_IMPORT_NOT_ALLOWED",
            };
          }
          try {
            verifiedLedger = await importPort.importReadyLedger(
              authorization,
              validatedLedger,
              importController.signal,
            );
          } catch (error) {
            if (
              error instanceof LedgerFileRepositoryError &&
              error.code ===
                LEDGER_FILE_REPOSITORY_ERROR_CODES.IMPORT_RECOVERY_BLOCKED
            ) {
              acceptingOperationsRef.current = false;
              readOnlyRef.current = true;
              if (mountedRef.current) {
                setIsReadOnly(true);
                setPersistenceError(
                  "The imported C could not be confirmed, and restoration of the original file could not be proven. All writes are disabled for this session; lock immediately and preserve the file for recovery.",
                );
              }
              return {
                ok: false,
                code: "LEDGER_IMPORT_RECOVERY_BLOCKED",
              };
            }
            if (
              error instanceof LedgerFileRepositoryError &&
              error.code ===
                LEDGER_FILE_REPOSITORY_ERROR_CODES.IMPORT_FAILED_BASE_RESTORED
            ) {
              if (mountedRef.current) {
                setPersistenceError(
                  "Import did not complete. A reread confirmed that C was restored to the complete pre-import version, and the page was not replaced.",
                );
              }
              return {
                ok: false,
                code: "LEDGER_IMPORT_BASE_RESTORED",
              };
            }
            if (
              error instanceof LedgerFileRepositoryError &&
              error.code ===
                LEDGER_FILE_REPOSITORY_ERROR_CODES.IMPORT_AUTHORIZATION_FAILED
            ) {
              return {
                ok: false,
                code: importController.signal.aborted
                  ? "LEDGER_IMPORT_CANCELLED"
                  : "LEDGER_IMPORT_NOT_ALLOWED",
              };
            }
            if (
              error instanceof LedgerFileRepositoryError &&
              error.code ===
                LEDGER_FILE_REPOSITORY_ERROR_CODES.EXTERNAL_CHANGE
            ) {
              if (mountedRef.current) {
                setPersistenceError(
                  "C changed outside this page before the import write. Nothing was written; reopen C.",
                );
              }
              return {
                ok: false,
                code: "LEDGER_IMPORT_SOURCE_CHANGED",
              };
            }
            if (importController.signal.aborted) {
              return {
                ok: false,
                code: "LEDGER_IMPORT_CANCELLED",
              };
            }
            if (mountedRef.current) {
              setPersistenceError(
                "Import failed before writing C, and the page was not replaced. No post-operation evidence proves that the old C was restored.",
              );
            }
            return {
              ok: false,
              code: LEDGER_REPOSITORY_ERROR_CODES.WRITE_FAILED,
            };
          }
        } else {
          try {
            await precedingQueue;
            await operationRepository.save(validatedLedger);
          } catch {
            return {
              ok: false,
              code: LEDGER_REPOSITORY_ERROR_CODES.WRITE_FAILED,
            };
          }
        }

        if (
          JSON.stringify(verifiedLedger) !== serializedCandidate
        ) {
          acceptingOperationsRef.current = false;
          readOnlyRef.current = true;
          if (mountedRef.current) {
            setIsReadOnly(true);
            setPersistenceError(
              "The ledger read after import does not match the preflight candidate. All writes are disabled for this session; lock immediately and reopen C.",
            );
          }
          return {
            ok: false,
            code: "LEDGER_IMPORT_RECOVERY_BLOCKED",
          };
        }

        if (
          mountedRef.current &&
          currentRepositoryRef.current === operationRepository &&
          operationTokenRef.current === operationToken &&
          generationRef.current === hookGeneration
        ) {
          generationRef.current += 1;
          ledgerDataRef.current = verifiedLedger;
          lastPersistedSnapshotRef.current = serializedCandidate;
          latestScheduledSnapshotRef.current = null;
          failedSnapshotRef.current = null;
          retryAttemptRef.current = null;
          pendingHydrationRef.current = null;
          hydratedRepositoryRef.current = operationRepository;
          hydrationErrorRepositoryRef.current = null;
          publishPersistenceVersionState({
            mutationVersion: 0,
            persistedVersion: 0,
            persistenceStatus: "saved",
          });
          reducerDispatch({
            type: "ledger/replace",
            ledgerData: verifiedLedger,
          });
          setPersistenceError(null);
          setResourcePolicyError(null);
          readOnlyRef.current = false;
          setIsReadOnly(false);
          setHydrationStatus("ready");
          setLedgerEpoch((current) => current + 1);
        }

        return { ok: true };
      };

      void executeImport().then(
        resolveImport,
        () =>
          resolveImport({
            ok: false,
            code: LEDGER_REPOSITORY_ERROR_CODES.WRITE_FAILED,
          }),
      );
      return importPromise;
    },
    [
      activeRepository,
      activeSession,
      activeCapabilities.canImportBackup,
      clock,
      hydrationStatus,
      publishPersistenceVersionState,
      trackSessionAcceptedWork,
    ],
  );

  const drainForSessionQuiesce = useCallback(
    (
      request: SessionQuiesceRequest,
    ): Promise<SessionQuiesceToken> => {
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
    },
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
    drainForSessionQuiesce,
  };
}

function invokeRepositorySave(
  repository: LedgerRepository,
  ledgerData: LedgerData,
): Promise<void> {
  try {
    return repository.save(ledgerData);
  } catch (error) {
    return Promise.reject(error);
  }
}

function isSamePersistenceTarget(
  firstRepository: LedgerRepository | null,
  firstSession: LedgerSession | undefined,
  secondRepository: LedgerRepository | null,
  secondSession: LedgerSession | undefined,
): boolean {
  if (firstSession || secondSession) {
    return firstSession === secondSession;
  }
  return firstRepository === secondRepository;
}

function isLedgerFileBackedRepository(
  repository: LedgerRepository,
  session: LedgerSession | undefined,
): boolean {
  return (
    session?.storageKind === "ledger-file" ||
    repository instanceof LedgerFileRepository
  );
}

function hasFutureFacts(ledgerData: LedgerData, todayKey: string): boolean {
  return (
    ledgerData.trades.some((trade) =>
      isLedgerFactInFuture(trade.occurredAt, todayKey),
    ) ||
    ledgerData.priceSnapshots.some((snapshot) =>
      isLedgerFactInFuture(snapshot.recordedAt, todayKey),
    )
  );
}

function isCorrectionAction(
  action: LedgerAction,
  ledgerData: LedgerData,
  todayKey: string,
): boolean {
  if (action.type === "futureFacts/deleteAll") {
    return action.todayKey === todayKey;
  }

  if (action.type === "trade/delete") {
    const trade = ledgerData.trades.find((item) => item.id === action.tradeId);
    return trade !== undefined && isLedgerFactInFuture(trade.occurredAt, todayKey);
  }

  if (action.type === "priceSnapshot/delete") {
    const snapshot = ledgerData.priceSnapshots.find(
      (item) => item.id === action.priceSnapshotId,
    );
    return (
      snapshot !== undefined &&
      isLedgerFactInFuture(snapshot.recordedAt, todayKey)
    );
  }

  return false;
}
