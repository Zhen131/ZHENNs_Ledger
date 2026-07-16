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
import type { LedgerRepository } from "../repositories/ledgerRepository";
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
  const mountedRef = useRef(true);
  const initialSnapshotRef = useRef(JSON.stringify(ledgerData));
  const lastPersistedSnapshotRef = useRef<string | null>(null);
  const latestScheduledSnapshotRef = useRef<string | null>(null);
  const writeQueueRef = useRef<Promise<void>>(Promise.resolve());

  useEffect(() => {
    mountedRef.current = true;
    let cancelled = false;

    async function hydrate() {
      try {
        const savedLedger = await repository.load();

        if (cancelled) {
          return;
        }

        if (savedLedger === null) {
          lastPersistedSnapshotRef.current = initialSnapshotRef.current;
          latestScheduledSnapshotRef.current = null;
        } else {
          const serialized = JSON.stringify(savedLedger);
          lastPersistedSnapshotRef.current = serialized;
          latestScheduledSnapshotRef.current = null;
          reducerDispatch({
            type: "ledger/replace",
            ledgerData: savedLedger,
          });
        }

        setPersistenceError(null);
        setHydrationStatus("ready");
      } catch {
        if (cancelled) {
          return;
        }

        setPersistenceError(
          "本地账本读取失败，已停止自动保存以避免覆盖原数据",
        );
        setHydrationStatus("error");
      }
    }

    void hydrate();

    return () => {
      cancelled = true;
      mountedRef.current = false;
    };
  }, [repository]);

  useEffect(() => {
    if (hydrationStatus !== "ready") {
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

    writeQueueRef.current = writeQueueRef.current
      .catch(() => undefined)
      .then(() => repository.save(ledgerSnapshot))
      .then(() => {
        lastPersistedSnapshotRef.current = serialized;

        if (latestScheduledSnapshotRef.current === serialized) {
          latestScheduledSnapshotRef.current = null;
        }

        if (mountedRef.current) {
          setPersistenceError(null);
        }
      })
      .catch(() => {
        if (latestScheduledSnapshotRef.current === serialized) {
          latestScheduledSnapshotRef.current = null;
        }

        if (mountedRef.current) {
          setPersistenceError(
            "本地保存失败，页面数据仍保留；刷新后将恢复上次成功保存的版本",
          );
        }
      });
  }, [hydrationStatus, ledgerData, repository]);

  const dispatch = useCallback<Dispatch<LedgerAction>>(
    (action) => {
      if (hydrationStatus !== "ready") {
        return;
      }

      reducerDispatch(action);
    },
    [hydrationStatus],
  );

  return {
    ledgerData,
    dispatch,
    hydrationStatus,
    persistenceError,
  };
}
