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
