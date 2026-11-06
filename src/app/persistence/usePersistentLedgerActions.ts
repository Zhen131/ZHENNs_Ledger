/**
 * 这个文件管页面改账的两个入口。
 * 先查能不能改，再改，再排进存盘队。
 * 存盘队本身在同目录 `usePersistentLedgerPersistence.ts`。
 * 不显然的决定：账本里有未来记录时，只许删未来记录。
 */
import type { LedgerData } from "@/core/models";
import { ledgerReducer, type LedgerAction } from "@/core/state";
import {
  captureLedgerTime,
  type LedgerClock,
  type LedgerTimeSnapshot,
} from "@/core/shared";
import {
  evaluateLedgerResourcePolicy,
  evaluateLedgerResourcePolicyAfterTradeAppend,
  type LedgerResourcePolicyError,
} from "@/core/validation";
import {
  type LedgerSession,
  type LedgerRepository,
} from "@/platform/persistence";
import type { HydrationStatus } from "./hydrationState";
import {
  type ApplyLedgerActionResult,
  type PersistenceOperation,
  type PersistenceVersionState,
  type RetryAttempt,
  type ScheduledSnapshot,
} from "./usePersistentLedgerTypes";
import {
  hasFutureFacts,
  isCorrectionAction,
} from "./usePersistentLedgerHelpers";

type ApplyLedgerMutationDeps = {
  acceptingOperationsRef: { current: boolean };
  activeRepository: LedgerRepository;
  activeSession: LedgerSession | undefined;
  clock: LedgerClock;
  failedSnapshotRef: { current: ScheduledSnapshot | null };
  hydratedRepositoryRef: { current: LedgerRepository | null };
  hydrationStatus: HydrationStatus;
  ledgerDataRef: { current: LedgerData };
  mountedRef: { current: boolean };
  operationRef: { current: PersistenceOperation };
  persistenceVersionStateRef: { current: PersistenceVersionState };
  readOnlyRef: { current: boolean };
  reducerDispatch: (action: LedgerAction) => void;
  registerAcceptedPersistence: (
    ledgerSnapshot: LedgerData,
    nextVersionState: PersistenceVersionState,
    scheduledRepository: LedgerRepository,
    scheduledSession: LedgerSession | undefined,
  ) => void;
  retryAttemptRef: { current: RetryAttempt | null };
  setPersistenceError: (nextValue: string | null) => void;
  setResourcePolicyError: (
    nextValue: LedgerResourcePolicyError | null,
  ) => void;
};

/**
 * 这个函数回答：按「整本账怎么变」来改账，改不改得成？
 * 账没读好、只读、正在清空或导入、有未来记录，都拒绝。
 * 改完超出条数或大小上限，也拒绝并留下上限错误。
 * 举例：改完和原来是同一本账 → 答 `noop`，什么都不存。
 * 改成了答 `applied`，并排一次存盘。不抛错。
 */
export function doApplyLedgerMutation(
  deps: ApplyLedgerMutationDeps,
  mutation: (current: LedgerData) => LedgerData,
  timeSnapshot?: LedgerTimeSnapshot,
): ApplyLedgerActionResult {
  const {
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
  } = deps;
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
}

type ApplyLedgerActionDeps = {
  acceptingOperationsRef: { current: boolean };
  activeRepository: LedgerRepository;
  activeSession: LedgerSession | undefined;
  clock: LedgerClock;
  failedSnapshotRef: { current: ScheduledSnapshot | null };
  hydratedRepositoryRef: { current: LedgerRepository | null };
  hydrationStatus: HydrationStatus;
  isFutureFactCorrectionMode: boolean;
  ledgerDataRef: { current: LedgerData };
  mountedRef: { current: boolean };
  operationRef: { current: PersistenceOperation };
  persistenceVersionStateRef: { current: PersistenceVersionState };
  readOnlyRef: { current: boolean };
  reducerDispatch: (action: LedgerAction) => void;
  registerAcceptedPersistence: (
    ledgerSnapshot: LedgerData,
    nextVersionState: PersistenceVersionState,
    scheduledRepository: LedgerRepository,
    scheduledSession: LedgerSession | undefined,
    action?: LedgerAction,
  ) => void;
  retryAttemptRef: { current: RetryAttempt | null };
  setPersistenceError: (nextValue: string | null) => void;
  setResourcePolicyError: (
    nextValue: LedgerResourcePolicyError | null,
  ) => void;
};

/**
 * 这个函数回答：拿一个改账单子来改账，改不改得成？
 * 拒绝的情形和上面那个一样，只是有未来记录时允许删它们。
 * 新加一笔买卖时，只查这一笔带来的上限变化。
 * 举例：记一笔买 0.1 BTC、成交 6500 USDT → 答 `applied`，排一次存盘。
 * 上次已全存好时，存盘带上这张单子，文件只写变了的部分。
 * 不抛错，失败都靠返回值说。
 */
export function doApplyLedgerAction(
  deps: ApplyLedgerActionDeps,
  action: LedgerAction,
  timeSnapshot?: LedgerTimeSnapshot,
): ApplyLedgerActionResult {
  const {
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
  } = deps;
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
        isFutureFactCorrectionMode &&
        !isCorrectionAction(action, currentLedgerData, operationTodayKey)
      ) {
        return "rejected";
      }

      const nextLedgerData = ledgerReducer(currentLedgerData, action);

      if (nextLedgerData === currentLedgerData) {
        return "noop";
      }

      const resourcePolicyResult =
        action.type === "trade/add"
          ? evaluateLedgerResourcePolicyAfterTradeAppend(
              nextLedgerData,
              action.trade,
            )
          : evaluateLedgerResourcePolicy(nextLedgerData);

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
        currentVersionState.persistedVersion ===
          currentVersionState.mutationVersion
          ? action
          : undefined,
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
}
