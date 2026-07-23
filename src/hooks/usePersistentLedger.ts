"use client";

import {
  useCallback,
  useEffect,
  useReducer,
  useRef,
  useState,
} from "react";

import type { LedgerData } from "../models";
import {
  LEDGER_REPOSITORY_ERROR_CODES,
  type LedgerRepository,
} from "../repositories/ledgerRepository";
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

export type PersistentLedgerState = {
  ledgerData: LedgerData;
  applyLedgerAction: (action: LedgerAction) => ApplyLedgerActionResult;
  hydrationStatus: HydrationStatus;
  persistenceError: string | null;
  resourcePolicyError: LedgerResourcePolicyError | null;
  isReadOnly: boolean;
  retryPersistence: () => Promise<boolean>;
  canRetryPersistence: boolean;
  clearLedger: () => Promise<ClearLedgerResult>;
  replaceLedgerFromBackup: (
    candidate: unknown,
  ) => Promise<ImportLedgerResult>;
  persistenceOperation: PersistenceOperation;
  persistenceStatus: PersistenceStatus;
  mutationVersion: number;
  persistedVersion: number;
  isDirty: boolean;
  repositorySwitchBlocked: boolean;
  discardDirtyChangesAndSwitchRepository: () => boolean;
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
        | typeof LEDGER_REPOSITORY_ERROR_CODES.WRITE_FAILED;
    };

/**
 * 统一管理启动读取、hydration 门禁和 ready 后的串行自动保存。
 */
export function usePersistentLedger(
  requestedRepository: LedgerRepository,
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
  const [, requestRepositorySwitchRender] = useState(0);
  const mountedRef = useRef(true);
  const activeRepositoryRef = useRef(requestedRepository);
  const repositorySwitchPermissionRef = useRef<LedgerRepository | null>(null);
  const currentRepositoryRef = useRef(requestedRepository);
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
  const pendingHydrationRef = useRef<{
    repository: LedgerRepository;
    generation: number;
    serializedLedger: string;
  } | null>(null);
  const readOnlyRef = useRef(false);

  const currentVersionState = persistenceVersionStateRef.current;
  const isCurrentlyDirty =
    currentVersionState.persistedVersion !== currentVersionState.mutationVersion;

  if (
    requestedRepository !== activeRepositoryRef.current &&
    operationRef.current !== "importing" &&
    (!isCurrentlyDirty ||
      repositorySwitchPermissionRef.current === requestedRepository)
  ) {
    activeRepositoryRef.current = requestedRepository;
    repositorySwitchPermissionRef.current = null;
  }

  const activeRepository = activeRepositoryRef.current;
  const repositorySwitchBlocked =
    requestedRepository !== activeRepository &&
    (isCurrentlyDirty || operationRef.current === "importing");
  const isDirty =
    persistenceVersionState.persistedVersion !==
    persistenceVersionState.mutationVersion;
  currentRepositoryRef.current = activeRepository;

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
    ): Promise<PersistenceAttemptResult> => {
      latestScheduledSnapshotRef.current = scheduledSnapshot;

      const persistenceAttempt = writeQueueRef.current
        .catch(() => undefined)
        .then(() => scheduledRepository.save(ledgerSnapshot))
        .then((): PersistenceAttemptResult => {
          if (
            currentRepositoryRef.current !== scheduledRepository ||
            hydratedRepositoryRef.current !== scheduledRepository ||
            generationRef.current !== scheduledSnapshot.generation
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

          const currentVersionState = persistenceVersionStateRef.current;
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
        .catch((): PersistenceAttemptResult => {
          if (
            currentRepositoryRef.current !== scheduledRepository ||
            hydratedRepositoryRef.current !== scheduledRepository ||
            generationRef.current !== scheduledSnapshot.generation
          ) {
            return "ignored";
          }

          if (
            latestScheduledSnapshotRef.current === scheduledSnapshot
          ) {
            latestScheduledSnapshotRef.current = null;
          }

          const currentVersionState = persistenceVersionStateRef.current;

          if (
            currentVersionState.mutationVersion === scheduledSnapshot.version
          ) {
            failedSnapshotRef.current = scheduledSnapshot;
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
              "本地保存失败，页面数据尚未保存；刷新后将恢复上次成功保存的版本",
            );
          }

          return "failed";
        });

      writeQueueRef.current = persistenceAttempt.then(() => undefined);
      return persistenceAttempt;
    },
    [publishPersistenceVersionState],
  );

  useEffect(() => {
    mountedRef.current = true;

    return () => {
      mountedRef.current = false;
      generationRef.current += 1;
      failedSnapshotRef.current = null;
      retryAttemptRef.current = null;
    };
  }, []);

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
    const generation = generationRef.current + 1;
    generationRef.current = generation;
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

        const hydratedLedger =
          savedLedger ?? createInitialLedgerData();
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
          "本地账本读取失败，已停止自动保存以避免覆盖原数据",
        );
        setHydrationStatus("error");
      }
    }

    void hydrate();

    return () => {
      cancelled = true;
    };
  }, [activeRepository, publishPersistenceVersionState]);

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
    setHydrationStatus("ready");
  }, [activeRepository, hydrationStatus, ledgerData]);

  useEffect(() => {
    if (
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

    if (mutationVersion === persistedVersion) {
      return;
    }

    if (serialized === lastPersistedSnapshotRef.current) {
      publishPersistenceVersionState({
        mutationVersion,
        persistedVersion: mutationVersion,
        persistenceStatus: "saved",
      });
      return;
    }

    const latestScheduledSnapshot = latestScheduledSnapshotRef.current;

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
    );
  }, [
    enqueuePersistence,
    hydrationStatus,
    ledgerData,
    persistenceOperation,
    persistenceVersionState.mutationVersion,
    publishPersistenceVersionState,
    activeRepository,
  ]);

  const applyLedgerAction = useCallback(
    (action: LedgerAction): ApplyLedgerActionResult => {
      if (
        hydrationStatus !== "ready" ||
        readOnlyRef.current ||
        operationRef.current !== "idle" ||
        hydratedRepositoryRef.current !== activeRepository
      ) {
        return "rejected";
      }

      const currentLedgerData = ledgerDataRef.current;
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
      publishPersistenceVersionState(nextVersionState);

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
      hydrationStatus,
      publishPersistenceVersionState,
    ],
  );

  const retryPersistence = useCallback((): Promise<boolean> => {
    const currentVersionState = persistenceVersionStateRef.current;
    const generation = generationRef.current;
    const currentRetryAttempt = retryAttemptRef.current;

    if (
      currentRetryAttempt?.generation === generation &&
      currentRetryAttempt.version === currentVersionState.mutationVersion
    ) {
      return currentRetryAttempt.promise;
    }

    const failedSnapshot = failedSnapshotRef.current;

    if (
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
  ]);

  const discardDirtyChangesAndSwitchRepository = useCallback((): boolean => {
    const versionState = persistenceVersionStateRef.current;

    if (
      operationRef.current !== "idle" ||
      requestedRepository === activeRepositoryRef.current ||
      versionState.persistedVersion === versionState.mutationVersion
    ) {
      return false;
    }

    repositorySwitchPermissionRef.current = requestedRepository;
    failedSnapshotRef.current = null;
    retryAttemptRef.current = null;
    requestRepositorySwitchRender((current) => current + 1);
    return true;
  }, [requestedRepository]);

  const clearLedger = useCallback((): Promise<ClearLedgerResult> => {
    if (
      operationRef.current === "clearing" &&
      operationRepositoryRef.current === activeRepository &&
      clearPromiseRef.current !== null
    ) {
      return clearPromiseRef.current;
    }

    const canClearReadyLedger =
      hydrationStatus === "ready" &&
      hydratedRepositoryRef.current === activeRepository;
    const canRecoverHydrationError =
      hydrationStatus === "error" &&
      hydrationErrorRepositoryRef.current === activeRepository;

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
    operationRef.current = "clearing";
    operationRepositoryRef.current = operationRepository;
    operationTokenRef.current = operationToken;
    failedSnapshotRef.current = null;
    retryAttemptRef.current = null;

    if (mountedRef.current) {
      setPersistenceOperation("clearing");
    }

    const clearPromise = writeQueueRef.current
      .catch(() => undefined)
      .then(async (): Promise<ClearLedgerResult> => {
        try {
          await operationRepository.clear();
        } catch {
          if (
            mountedRef.current &&
            currentRepositoryRef.current === operationRepository &&
            operationTokenRef.current === operationToken
          ) {
            setPersistenceError(
              "清空本地账本失败，原页面与本地数据均未更改",
            );
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

    return clearPromise;
  }, [
    activeRepository,
    hydrationStatus,
    publishPersistenceVersionState,
  ]);

  const replaceLedgerFromBackup = useCallback(
    (candidate: unknown): Promise<ImportLedgerResult> => {
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

      if (
        operationRef.current !== "idle" ||
        (!canImportReadyLedger && !canRecoverHydrationError)
      ) {
        return Promise.resolve({ ok: false, code: "LEDGER_IMPORT_NOT_ALLOWED" });
      }

      const ledgerResult = validateLedgerData(candidate);
      if (!ledgerResult.ok || !evaluateLedgerResourcePolicy(ledgerResult.value).ok) {
        return Promise.resolve({ ok: false, code: "LEDGER_IMPORT_INVALID_BACKUP" });
      }

      const validatedLedger = ledgerResult.value;
      const operationToken = Symbol("import-ledger");
      const operationRepository = activeRepository;
      operationRef.current = "importing";
      operationRepositoryRef.current = operationRepository;
      operationTokenRef.current = operationToken;

      if (mountedRef.current) {
        setPersistenceOperation("importing");
      }

      const importPromise = writeQueueRef.current
        .catch(() => undefined)
        .then(async (): Promise<ImportLedgerResult> => {
          try {
            await operationRepository.save(validatedLedger);
          } catch {
            return {
              ok: false,
              code: LEDGER_REPOSITORY_ERROR_CODES.WRITE_FAILED,
            };
          }

          if (
            mountedRef.current &&
            currentRepositoryRef.current === operationRepository &&
            operationTokenRef.current === operationToken
          ) {
            const serializedLedger = JSON.stringify(validatedLedger);
            generationRef.current += 1;
            ledgerDataRef.current = validatedLedger;
            lastPersistedSnapshotRef.current = serializedLedger;
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
              ledgerData: validatedLedger,
            });
            setPersistenceError(null);
            setResourcePolicyError(null);
            readOnlyRef.current = false;
            setIsReadOnly(false);
            setHydrationStatus("ready");
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
          importPromiseRef.current = null;

          if (mountedRef.current) {
            setPersistenceOperation("idle");
          }
        });

      importPromiseRef.current = importPromise;
      writeQueueRef.current = importPromise.then(() => undefined);
      return importPromise;
    },
    [activeRepository, hydrationStatus, publishPersistenceVersionState],
  );

  return {
    ledgerData,
    applyLedgerAction,
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
  };
}
