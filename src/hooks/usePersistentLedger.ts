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

export type PersistentLedgerState = {
  ledgerData: LedgerData;
  applyLedgerAction: (action: LedgerAction) => ApplyLedgerActionResult;
  hydrationStatus: HydrationStatus;
  persistenceError: string | null;
  clearLedger: () => Promise<ClearLedgerResult>;
  persistenceOperation: PersistenceOperation;
  persistenceStatus: PersistenceStatus;
  mutationVersion: number;
  persistedVersion: number;
};

export type PersistenceOperation = "idle" | "clearing";
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

/**
 * 统一管理启动读取、hydration 门禁和 ready 后的串行自动保存。
 */
export function usePersistentLedger(
  repository: LedgerRepository,
): PersistentLedgerState {
  const [ledgerData, reducerDispatch] = useReducer(
    ledgerReducer,
    undefined,
    createInitialLedgerData,
  );
  const [hydrationStatus, setHydrationStatus] =
    useState<HydrationStatus>("loading");
  const [persistenceError, setPersistenceError] = useState<string | null>(null);
  const [persistenceOperation, setPersistenceOperation] =
    useState<PersistenceOperation>("idle");
  const [persistenceVersionState, setPersistenceVersionState] =
    useState<PersistenceVersionState>(INITIAL_PERSISTENCE_VERSION_STATE);
  const mountedRef = useRef(true);
  const currentRepositoryRef = useRef(repository);
  const ledgerDataRef = useRef(ledgerData);
  const generationRef = useRef(0);
  const persistenceVersionStateRef =
    useRef<PersistenceVersionState>(INITIAL_PERSISTENCE_VERSION_STATE);
  const lastPersistedSnapshotRef = useRef<string | null>(null);
  const latestScheduledSnapshotRef = useRef<ScheduledSnapshot | null>(null);
  const writeQueueRef = useRef<Promise<void>>(Promise.resolve());
  const hydratedRepositoryRef = useRef<LedgerRepository | null>(null);
  const hydrationErrorRepositoryRef = useRef<LedgerRepository | null>(null);
  const operationRef = useRef<PersistenceOperation>("idle");
  const operationRepositoryRef = useRef<LedgerRepository | null>(null);
  const operationTokenRef = useRef<symbol | null>(null);
  const clearPromiseRef = useRef<Promise<ClearLedgerResult> | null>(null);
  const pendingHydrationRef = useRef<{
    repository: LedgerRepository;
    generation: number;
    serializedLedger: string;
  } | null>(null);

  currentRepositoryRef.current = repository;

  const publishPersistenceVersionState = useCallback(
    (nextState: PersistenceVersionState) => {
      persistenceVersionStateRef.current = nextState;

      if (mountedRef.current) {
        setPersistenceVersionState(nextState);
      }
    },
    [],
  );

  useEffect(() => {
    mountedRef.current = true;

    return () => {
      mountedRef.current = false;
      generationRef.current += 1;
    };
  }, []);

  useEffect(() => {
    const generation = generationRef.current + 1;
    generationRef.current = generation;
    hydratedRepositoryRef.current = null;
    hydrationErrorRepositoryRef.current = null;
    pendingHydrationRef.current = null;
    lastPersistedSnapshotRef.current = null;
    latestScheduledSnapshotRef.current = null;
    writeQueueRef.current = Promise.resolve();
    publishPersistenceVersionState(INITIAL_PERSISTENCE_VERSION_STATE);

    if (operationRef.current !== "idle") {
      operationRef.current = "idle";
      operationRepositoryRef.current = null;
      operationTokenRef.current = null;
      clearPromiseRef.current = null;
      setPersistenceOperation("idle");
    }

    setHydrationStatus("loading");
    let cancelled = false;

    async function hydrate() {
      try {
        const savedLedger = await repository.load();

        if (cancelled || generationRef.current !== generation) {
          return;
        }

        const hydratedLedger =
          savedLedger ?? createInitialLedgerData();
        const serializedLedger = JSON.stringify(hydratedLedger);
        ledgerDataRef.current = hydratedLedger;
        lastPersistedSnapshotRef.current = serializedLedger;
        pendingHydrationRef.current = {
          repository,
          generation,
          serializedLedger,
        };
        hydrationErrorRepositoryRef.current = null;
        reducerDispatch({
          type: "ledger/replace",
          ledgerData: hydratedLedger,
        });

        setPersistenceError(null);
      } catch {
        if (cancelled || generationRef.current !== generation) {
          return;
        }

        pendingHydrationRef.current = null;
        hydratedRepositoryRef.current = null;
        hydrationErrorRepositoryRef.current = repository;
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
  }, [publishPersistenceVersionState, repository]);

  useEffect(() => {
    const pendingHydration = pendingHydrationRef.current;

    if (
      hydrationStatus !== "loading" ||
      pendingHydration === null ||
      pendingHydration.repository !== repository ||
      pendingHydration.generation !== generationRef.current ||
      JSON.stringify(ledgerData) !== pendingHydration.serializedLedger
    ) {
      return;
    }

    pendingHydrationRef.current = null;
    hydratedRepositoryRef.current = repository;
    setHydrationStatus("ready");
  }, [hydrationStatus, ledgerData, repository]);

  useEffect(() => {
    if (
      hydrationStatus !== "ready" ||
      operationRef.current !== "idle" ||
      hydratedRepositoryRef.current !== repository
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

    const scheduledSnapshot: ScheduledSnapshot = {
      generation,
      version: mutationVersion,
      serializedLedger: serialized,
    };
    latestScheduledSnapshotRef.current = scheduledSnapshot;
    const ledgerSnapshot = ledgerData;
    const scheduledRepository = repository;

    writeQueueRef.current = writeQueueRef.current
      .catch(() => undefined)
      .then(() => scheduledRepository.save(ledgerSnapshot))
      .then(() => {
        if (
          currentRepositoryRef.current !== scheduledRepository ||
          hydratedRepositoryRef.current !== scheduledRepository ||
          generationRef.current !== generation
        ) {
          return;
        }

        lastPersistedSnapshotRef.current = serialized;

        if (latestScheduledSnapshotRef.current === scheduledSnapshot) {
          latestScheduledSnapshotRef.current = null;
        }

        const currentVersionState = persistenceVersionStateRef.current;
        const nextPersistedVersion = Math.max(
          currentVersionState.persistedVersion,
          mutationVersion,
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
      })
      .catch(() => {
        if (
          currentRepositoryRef.current !== scheduledRepository ||
          hydratedRepositoryRef.current !== scheduledRepository ||
          generationRef.current !== generation
        ) {
          return;
        }

        if (latestScheduledSnapshotRef.current === scheduledSnapshot) {
          latestScheduledSnapshotRef.current = null;
        }

        const currentVersionState = persistenceVersionStateRef.current;

        if (
          currentVersionState.mutationVersion === mutationVersion
        ) {
          publishPersistenceVersionState({
            ...currentVersionState,
            persistenceStatus: "error",
          });
        }

        if (
          mountedRef.current &&
          currentVersionState.mutationVersion === mutationVersion
        ) {
          setPersistenceError(
            "本地保存失败，页面数据仍保留；刷新后将恢复上次成功保存的版本",
          );
        }
      });
  }, [
    hydrationStatus,
    ledgerData,
    persistenceOperation,
    persistenceVersionState.mutationVersion,
    publishPersistenceVersionState,
    repository,
  ]);

  const applyLedgerAction = useCallback(
    (action: LedgerAction): ApplyLedgerActionResult => {
      if (
        hydrationStatus !== "ready" ||
        operationRef.current !== "idle" ||
        hydratedRepositoryRef.current !== repository
      ) {
        return "rejected";
      }

      const currentLedgerData = ledgerDataRef.current;
      const nextLedgerData = ledgerReducer(currentLedgerData, action);

      if (nextLedgerData === currentLedgerData) {
        return "noop";
      }

      const currentVersionState = persistenceVersionStateRef.current;
      const nextVersionState: PersistenceVersionState = {
        ...currentVersionState,
        mutationVersion: currentVersionState.mutationVersion + 1,
        persistenceStatus: "saving",
      };
      ledgerDataRef.current = nextLedgerData;
      publishPersistenceVersionState(nextVersionState);

      if (mountedRef.current) {
        setPersistenceError(null);
      }

      reducerDispatch({
        type: "ledger/replace",
        ledgerData: nextLedgerData,
      });

      return "applied";
    },
    [hydrationStatus, publishPersistenceVersionState, repository],
  );

  const clearLedger = useCallback((): Promise<ClearLedgerResult> => {
    if (
      operationRef.current === "clearing" &&
      operationRepositoryRef.current === repository &&
      clearPromiseRef.current !== null
    ) {
      return clearPromiseRef.current;
    }

    const canClearReadyLedger =
      hydrationStatus === "ready" &&
      hydratedRepositoryRef.current === repository;
    const canRecoverHydrationError =
      hydrationStatus === "error" &&
      hydrationErrorRepositoryRef.current === repository;

    if (
      operationRef.current !== "idle" ||
      (!canClearReadyLedger && !canRecoverHydrationError)
    ) {
      return Promise.resolve({
        ok: false,
        code: LEDGER_REPOSITORY_ERROR_CODES.CLEAR_FAILED,
      });
    }

    const operationToken = Symbol("clear-ledger");
    const operationRepository = repository;
    operationRef.current = "clearing";
    operationRepositoryRef.current = operationRepository;
    operationTokenRef.current = operationToken;

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
  }, [hydrationStatus, publishPersistenceVersionState, repository]);

  return {
    ledgerData,
    applyLedgerAction,
    hydrationStatus,
    persistenceError,
    clearLedger,
    persistenceOperation,
    persistenceStatus: persistenceVersionState.persistenceStatus,
    mutationVersion: persistenceVersionState.mutationVersion,
    persistedVersion: persistenceVersionState.persistedVersion,
  };
}
