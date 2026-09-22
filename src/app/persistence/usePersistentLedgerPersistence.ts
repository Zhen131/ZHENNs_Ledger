import type { LedgerData } from "@/core/models";
import {
  type LedgerSession,
  type LedgerRepository,
} from "@/platform/persistence";
import {
  LEDGER_FILE_REPOSITORY_ERROR_CODES,
  LedgerFileRepositoryError,
} from "@/platform/files";
import type { LedgerAction } from "@/core/state";
import { translateDefault } from "@/ui";
import type { HydrationStatus } from "./hydrationState";
import type {
  PersistenceAttemptResult,
  PersistenceOperation,
  PersistenceVersionState,
  RetryAttempt,
  ScheduledSnapshot,
} from "./usePersistentLedgerTypes";
import {
  invokeRepositoryActionSave,
  invokeRepositorySave,
  isLedgerFileBackedRepository,
} from "./usePersistentLedgerHelpers";

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

type RunAutomaticPersistenceEffectDeps = {
  acceptingOperationsRef: { current: boolean };
  activeRepository: LedgerRepository;
  activeSession: LedgerSession | undefined;
  enqueuePersistence: (
    scheduledSnapshot: ScheduledSnapshot,
    ledgerSnapshot: LedgerData,
    scheduledRepository: LedgerRepository,
    scheduledSession: LedgerSession | undefined,
  ) => unknown;
  failedSnapshotRef: { current: ScheduledSnapshot | null };
  generationRef: { current: number };
  hydratedRepositoryRef: { current: LedgerRepository | null };
  hydrationStatus: HydrationStatus;
  lastPersistedSnapshotRef: { current: string | null };
  latestScheduledSnapshotRef: { current: ScheduledSnapshot | null };
  ledgerData: LedgerData;
  operationRef: { current: PersistenceOperation };
  persistenceVersionStateRef: { current: PersistenceVersionState };
  publishPersistenceVersionState: (nextState: PersistenceVersionState) => void;
  readOnlyRef: { current: boolean };
};

export function runAutomaticPersistenceEffect(
  deps: RunAutomaticPersistenceEffectDeps,
): void {
  const {
    acceptingOperationsRef,
    activeRepository,
    activeSession,
    enqueuePersistence,
    failedSnapshotRef,
    generationRef,
    hydratedRepositoryRef,
    hydrationStatus,
    lastPersistedSnapshotRef,
    latestScheduledSnapshotRef,
    ledgerData,
    operationRef,
    persistenceVersionStateRef,
    publishPersistenceVersionState,
    readOnlyRef,
  } = deps;
    if (
      !acceptingOperationsRef.current ||
      hydrationStatus !== "ready" ||
      readOnlyRef.current ||
      operationRef.current !== "idle" ||
      hydratedRepositoryRef.current !== activeRepository
    ) {
      return;
    }

    const { mutationVersion, persistedVersion } =
      persistenceVersionStateRef.current;
    const generation = generationRef.current;
    const latestScheduledSnapshot =
      latestScheduledSnapshotRef.current;
    const requiresRepositoryNoOpVerification =
      isLedgerFileBackedRepository(
        activeRepository,
        activeSession,
      );

    if (mutationVersion === persistedVersion) {
      return;
    }

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

    const serialized = requiresRepositoryNoOpVerification
      ? null
      : JSON.stringify(ledgerData);

    if (
      serialized === lastPersistedSnapshotRef.current &&
      latestScheduledSnapshot?.generation !== generation &&
      !requiresRepositoryNoOpVerification
    ) {
      publishPersistenceVersionState({
        mutationVersion,
        persistedVersion: mutationVersion,
        persistenceStatus: "saved",
      });
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
      activeSession,
    );
}

type EnqueuePersistenceDeps = {
  currentRepositoryRef: { current: LedgerRepository };
  failedSnapshotRef: { current: ScheduledSnapshot | null };
  generationRef: { current: number };
  hydratedRepositoryRef: { current: LedgerRepository | null };
  lastPersistedSnapshotRef: { current: string | null };
  latestScheduledSnapshotRef: { current: ScheduledSnapshot | null };
  mountedRef: { current: boolean };
  persistenceVersionStateRef: { current: PersistenceVersionState };
  publishPersistenceVersionState: (nextState: PersistenceVersionState) => void;
  setPersistenceError: (nextValue: string | null) => void;
  trackSessionAcceptedWork: (
    session: LedgerSession | undefined,
    work: PromiseLike<unknown>,
  ) => void;
  writeQueueRef: { current: Promise<void> };
};

export function doEnqueuePersistence(
  deps: EnqueuePersistenceDeps,
  scheduledSnapshot: ScheduledSnapshot,
  ledgerSnapshot: LedgerData,
  scheduledRepository: LedgerRepository,
  scheduledSession: LedgerSession | undefined,
): Promise<PersistenceAttemptResult> {
  const {
    currentRepositoryRef,
    failedSnapshotRef,
    generationRef,
    hydratedRepositoryRef,
    lastPersistedSnapshotRef,
    latestScheduledSnapshotRef,
    mountedRef,
    persistenceVersionStateRef,
    publishPersistenceVersionState,
    setPersistenceError,
    trackSessionAcceptedWork,
    writeQueueRef,
  } = deps;
      latestScheduledSnapshotRef.current = scheduledSnapshot;
      const usesLatestFileSave =
        isLedgerFileBackedRepository(
          scheduledRepository,
          scheduledSession,
        );
      const precedingQueue = writeQueueRef.current.catch(
        () => undefined,
      );
      const saveAttempt = usesLatestFileSave
        ? scheduledSnapshot.action &&
          scheduledRepository.saveAfterAction
          ? invokeRepositoryActionSave(
              scheduledRepository,
              scheduledSnapshot.action,
              ledgerSnapshot,
            )
          : invokeRepositorySave(scheduledRepository, ledgerSnapshot)
        : precedingQueue.then(() =>
            scheduledRepository.save(ledgerSnapshot),
          );

      const persistenceAttempt = saveAttempt
        .then((): PersistenceAttemptResult => {
          if (
            currentRepositoryRef.current !== scheduledRepository ||
            hydratedRepositoryRef.current !== scheduledRepository ||
            generationRef.current !== scheduledSnapshot.generation
          ) {
            return "ignored";
          }

          const currentVersionState =
            persistenceVersionStateRef.current;
          if (
            usesLatestFileSave &&
            scheduledSnapshot.version <
              currentVersionState.mutationVersion
          ) {
            return "ignored";
          }

          if (scheduledSnapshot.serializedLedger !== null) {
            lastPersistedSnapshotRef.current =
              scheduledSnapshot.serializedLedger;
          }

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
        .catch((error: unknown): PersistenceAttemptResult => {
          if (
            currentRepositoryRef.current !== scheduledRepository ||
            hydratedRepositoryRef.current !== scheduledRepository ||
            generationRef.current !== scheduledSnapshot.generation
          ) {
            return "ignored";
          }

          const currentVersionState =
            persistenceVersionStateRef.current;
          if (
            usesLatestFileSave &&
            scheduledSnapshot.version <
              currentVersionState.mutationVersion
          ) {
            return "ignored";
          }

          if (
            latestScheduledSnapshotRef.current === scheduledSnapshot
          ) {
            latestScheduledSnapshotRef.current = null;
          }

          const requiresReopen =
            error instanceof LedgerFileRepositoryError &&
            error.code ===
              LEDGER_FILE_REPOSITORY_ERROR_CODES.EXTERNAL_CHANGE;

          if (
            currentVersionState.mutationVersion === scheduledSnapshot.version
          ) {
            failedSnapshotRef.current = requiresReopen
              ? null
              : scheduledSnapshot;
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
              requiresReopen
                ? translateDefault("persistence.externalChange")
                : translateDefault("persistence.saveFailed"),
            );
          }

          return "failed";
        });

      writeQueueRef.current = usesLatestFileSave
        ? Promise.all([precedingQueue, persistenceAttempt]).then(
            () => undefined,
          )
        : persistenceAttempt.then(() => undefined);
      trackSessionAcceptedWork(scheduledSession, persistenceAttempt);
      return persistenceAttempt;
}
