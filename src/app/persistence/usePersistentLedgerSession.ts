import type {
  Dispatch,
  RefObject,
  SetStateAction,
} from "react";
import type {
  LedgerRepository,
  LedgerSession,
} from "@/platform/persistence";
import type {
  PersistenceOperation,
  PersistenceVersionState,
  RetryAttempt,
  ScheduledSnapshot,
  SessionPersistenceBinding,
} from "./usePersistentLedgerTypes";
import { isSamePersistenceTarget } from "./usePersistentLedgerHelpers";

type TrackSessionAcceptedWorkDeps = {
  sessionPersistenceBindingsRef: RefObject<WeakMap<LedgerSession, SessionPersistenceBinding>>;
};

export function doTrackSessionAcceptedWork(
  deps: TrackSessionAcceptedWorkDeps,
  session: LedgerSession | undefined,
  work: PromiseLike<unknown>,
): void {
  const {
    sessionPersistenceBindingsRef,
  } = deps;
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
}

type DiscardDirtyChangesAndSwitchRepositoryDeps = {
  acceptingOperationsRef: RefObject<boolean>;
  activePersistenceTargetRef: RefObject<Readonly<{ repository: LedgerRepository; session: LedgerSession | undefined; }>>;
  failedSnapshotRef: RefObject<ScheduledSnapshot | null>;
  operationRef: RefObject<PersistenceOperation>;
  persistenceVersionStateRef: RefObject<PersistenceVersionState>;
  repositorySwitchPermissionRef: RefObject<LedgerRepository | null>;
  requestRepositorySwitchRender: Dispatch<SetStateAction<number>>;
  requestedPersistenceRepository: LedgerRepository;
  requestedSession: LedgerSession | undefined;
  retryAttemptRef: RefObject<RetryAttempt | null>;
};

export function doDiscardDirtyChangesAndSwitchRepository(
  deps: DiscardDirtyChangesAndSwitchRepositoryDeps,
): boolean {
  const {
    acceptingOperationsRef,
    activePersistenceTargetRef,
    failedSnapshotRef,
    operationRef,
    persistenceVersionStateRef,
    repositorySwitchPermissionRef,
    requestRepositorySwitchRender,
    requestedPersistenceRepository,
    requestedSession,
    retryAttemptRef,
  } = deps;
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
}
