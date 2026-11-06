/**
 * 这个文件管账本自动存盘：排队，重试，存完后更新状态。
 * 改账入口在 `usePersistentLedgerActions.ts`，清空和导入在别的文件。
 * 存在账本文件里时，不在这边比文字省掉存盘。
 * 是否真的没变，交给文件仓库自己核。
 * 没有特别的决定。
 */
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

/**
 * 这个函数把一次已接受的改动排进存盘队。
 * 不是账本文件时，账本文字和上次存的一样，就直接算存好。
 * 举例：改完又改回原样 → 不真存，状态直接变「存好了」。
 * 不会出错；存盘的结果由排队那一步处理。
 */
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

/**
 * 这个函数回答：用户点重试存盘，能不能重试，成没成？
 * 只有最近一次存失败、而且之后没再改过，才重试。
 * 同一次改动正在重试时，交回那一次的结果，不另起一次。
 * 举例：存失败后点重试，这次存好了 → 答 true。
 * 不能重试或重试又失败，答 false，不抛错。
 */
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

/**
 * 这个函数在页面每次刷新后，看有没有改动还没排进存盘队。
 * 有就补排一次；已经在排或已经存好，就不动。
 * 不会出错。
 */
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

    // 为什么失败的那次不在这里再排：它只等重试或下次改动。
    // 否则一次无关的导入失败后页面刷新，又会把它排进去。
    // 2026-07-23 提交 0fabe6f 写下这个理由。
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

/**
 * 这个函数真正发起一次存盘，并在结束后更新存盘状态。
 * 账本文件直接交给文件仓库，它自己保证只留最新一次。
 * 别的仓库要等前一次存完才开始。
 * 存好答 `saved`；失败答 `failed` 并记下失败的那次。
 * 存完时已经换了账本或有了更新的改动，答 `ignored`，不改状态。
 * 文件被别的程序改过时，提示重新打开，不留重试。
 * 不抛错，结果都在返回值里。
 */
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
