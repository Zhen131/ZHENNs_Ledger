import type { LedgerData } from "@/core/models";
import {
  type LedgerSession,
  type LedgerRepository,
} from "@/platform/persistence";
import type { LedgerAction } from "@/core/state";
import type {
  PersistenceVersionState,
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
