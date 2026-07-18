"use client";

import {
  useCallback,
  useEffect,
  useReducer,
  useRef,
  useState,
  type Dispatch,
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
  dispatch: Dispatch<LedgerAction>;
  hydrationStatus: HydrationStatus;
  persistenceError: string | null;
  clearLedger: () => Promise<ClearLedgerResult>;
  persistenceOperation: PersistenceOperation;
};

export type PersistenceOperation = "idle" | "clearing";

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
  const mountedRef = useRef(true);
  const currentRepositoryRef = useRef(repository);
  const lastPersistedSnapshotRef = useRef<string | null>(null);
  const latestScheduledSnapshotRef = useRef<string | null>(null);
  const writeQueueRef = useRef<Promise<void>>(Promise.resolve());
  const hydratedRepositoryRef = useRef<LedgerRepository | null>(null);
  const hydrationErrorRepositoryRef = useRef<LedgerRepository | null>(null);
  const operationRef = useRef<PersistenceOperation>("idle");
  const operationRepositoryRef = useRef<LedgerRepository | null>(null);
  const operationTokenRef = useRef<symbol | null>(null);
  const clearPromiseRef = useRef<Promise<ClearLedgerResult> | null>(null);
  const pendingHydrationRef = useRef<{
    repository: LedgerRepository;
    serializedLedger: string;
  } | null>(null);

  currentRepositoryRef.current = repository;

  useEffect(() => {
    mountedRef.current = true;

    return () => {
      mountedRef.current = false;
    };
  }, []);

  useEffect(() => {
    hydratedRepositoryRef.current = null;
    hydrationErrorRepositoryRef.current = null;
    pendingHydrationRef.current = null;
    lastPersistedSnapshotRef.current = null;
    latestScheduledSnapshotRef.current = null;
    writeQueueRef.current = Promise.resolve();

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

        if (cancelled) {
          return;
        }

        const hydratedLedger =
          savedLedger ?? createInitialLedgerData();
        const serializedLedger = JSON.stringify(hydratedLedger);
        lastPersistedSnapshotRef.current = serializedLedger;
        pendingHydrationRef.current = {
          repository,
          serializedLedger,
        };
        hydrationErrorRepositoryRef.current = null;
        reducerDispatch({
          type: "ledger/replace",
          ledgerData: hydratedLedger,
        });

        setPersistenceError(null);
      } catch {
        if (cancelled) {
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
  }, [repository]);

  useEffect(() => {
    const pendingHydration = pendingHydrationRef.current;

    if (
      hydrationStatus !== "loading" ||
      pendingHydration === null ||
      pendingHydration.repository !== repository ||
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

    if (
      serialized === lastPersistedSnapshotRef.current ||
      serialized === latestScheduledSnapshotRef.current
    ) {
      return;
    }

    latestScheduledSnapshotRef.current = serialized;
    const ledgerSnapshot = ledgerData;
    const scheduledRepository = repository;

    writeQueueRef.current = writeQueueRef.current
      .catch(() => undefined)
      .then(() => scheduledRepository.save(ledgerSnapshot))
      .then(() => {
        if (
          currentRepositoryRef.current !== scheduledRepository ||
          hydratedRepositoryRef.current !== scheduledRepository
        ) {
          return;
        }

        lastPersistedSnapshotRef.current = serialized;

        if (latestScheduledSnapshotRef.current === serialized) {
          latestScheduledSnapshotRef.current = null;
        }

        if (mountedRef.current) {
          setPersistenceError(null);
        }
      })
      .catch(() => {
        if (
          currentRepositoryRef.current !== scheduledRepository ||
          hydratedRepositoryRef.current !== scheduledRepository
        ) {
          return;
        }

        if (latestScheduledSnapshotRef.current === serialized) {
          latestScheduledSnapshotRef.current = null;
        }

        if (mountedRef.current) {
          setPersistenceError(
            "本地保存失败，页面数据仍保留；刷新后将恢复上次成功保存的版本",
          );
        }
      });
  }, [hydrationStatus, ledgerData, persistenceOperation, repository]);

  const dispatch = useCallback<Dispatch<LedgerAction>>(
    (action) => {
      if (
        hydrationStatus !== "ready" ||
        operationRef.current !== "idle" ||
        hydratedRepositoryRef.current !== repository
      ) {
        return;
      }

      reducerDispatch(action);
    },
    [hydrationStatus, repository],
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
          lastPersistedSnapshotRef.current = serializedInitialLedger;
          latestScheduledSnapshotRef.current = null;
          pendingHydrationRef.current = null;
          hydratedRepositoryRef.current = operationRepository;
          hydrationErrorRepositoryRef.current = null;
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
  }, [hydrationStatus, repository]);

  return {
    ledgerData,
    dispatch,
    hydrationStatus,
    persistenceError,
    clearLedger,
    persistenceOperation,
  };
}
