import type { LedgerData } from "@/core/models";
import {
  type LedgerSession,
  type LedgerRepository,
} from "@/platform/persistence";
import type { LedgerAction } from "@/core/state";
import type { HydrationStatus } from "./hydrationState";
import type {
  PersistenceAttemptResult,
  PersistenceVersionState,
  RetryAttempt,
  ScheduledSnapshot,
} from "./usePersistentLedgerTypes";
import { isLedgerFileBackedRepository } from "./usePersistentLedgerHelpers";

type RegisterAcceptedPersistenceDeps = {
  enqueuePersistence: (
    scheduledSnapshot: ScheduledSnapshot,
    ledgerSnapshot: LedgerData,
    scheduledRepository: LedgerRepository,
    scheduledSession: LedgerSession | undefined,
  ) => unknown;
  generationRef: { current: number };
  lastPersistedSnapshotRef: { current: string | null };
  publishPersistenceVersionState: (nextState: PersistenceVersionState) => void;
};

export function doRegisterAcceptedPersistence(
  deps: RegisterAcceptedPersistenceDeps,
  ledgerSnapshot: LedgerData,
  nextVersionState: PersistenceVersionState,
  scheduledRepository: LedgerRepository,
  scheduledSession: LedgerSession | undefined,
  action?: LedgerAction,
): void {
  const {
    enqueuePersistence,
    generationRef,
    lastPersistedSnapshotRef,
    publishPersistenceVersionState,
  } = deps;
      const requiresRepositoryNoOpVerification =
        isLedgerFileBackedRepository(
          scheduledRepository,
          scheduledSession,
        );
      const serializedLedger = requiresRepositoryNoOpVerification
        ? null
        : JSON.stringify(ledgerSnapshot);
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
        ...(action ? { action } : {}),
      };
      void enqueuePersistence(
        scheduledSnapshot,
        ledgerSnapshot,
        scheduledRepository,
        scheduledSession,
      );
}

type RetryPersistenceDeps = {
  acceptingOperationsRef: { current: boolean };
  activeRepository: LedgerRepository;
  activeSession: LedgerSession | undefined;
  enqueuePersistence: (
    scheduledSnapshot: ScheduledSnapshot,
    ledgerSnapshot: LedgerData,
    scheduledRepository: LedgerRepository,
    scheduledSession: LedgerSession | undefined,
  ) => Promise<PersistenceAttemptResult>;
  failedSnapshotRef: { current: ScheduledSnapshot | null };
  generationRef: { current: number };
  hydratedRepositoryRef: { current: LedgerRepository | null };
  hydrationStatus: HydrationStatus;
  ledgerDataRef: { current: LedgerData };
  mountedRef: { current: boolean };
  operationRef: { current: "idle" | "clearing" | "importing" };
  persistenceVersionStateRef: { current: PersistenceVersionState };
  publishPersistenceVersionState: (nextState: PersistenceVersionState) => void;
  readOnlyRef: { current: boolean };
  retryAttemptRef: { current: RetryAttempt | null };
  setPersistenceError: (nextValue: string | null) => void;
};

export function doRetryPersistence(
  deps: RetryPersistenceDeps,
): Promise<boolean> {
  const {
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
  } = deps;
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
      serializedLedger: isLedgerFileBackedRepository(
        activeRepository,
        activeSession,
      )
        ? null
        : JSON.stringify(ledgerSnapshot),
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
}
