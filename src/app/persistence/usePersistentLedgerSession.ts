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
import type { HydrationStatus } from "./hydrationState";
import type { LedgerData } from "@/core/models";

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

type HydrationCompletionEffectDeps = {
  activeRepository: LedgerRepository;
  generationRef: RefObject<number>;
  hydratedRepositoryRef: RefObject<LedgerRepository | null>;
  hydrationStatus: HydrationStatus;
  ledgerData: LedgerData;
  pendingHydrationRef: RefObject<{
    repository: LedgerRepository;
    generation: number;
    serializedLedger: string;
  } | null>;
  setHydrationStatus: Dispatch<SetStateAction<HydrationStatus>>;
  setLedgerEpoch: Dispatch<SetStateAction<number>>;
};

export function runHydrationCompletionEffect(
  deps: HydrationCompletionEffectDeps,
) {
  const {
    activeRepository,
    generationRef,
    hydratedRepositoryRef,
    hydrationStatus,
    ledgerData,
    pendingHydrationRef,
    setHydrationStatus,
    setLedgerEpoch,
  } = deps;
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
}
