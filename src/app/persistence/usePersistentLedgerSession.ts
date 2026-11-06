/**
 * 这个文件管账本存取 hook 和会话之间的三件小事。
 * 记下会话手上的活；放弃没存的改动去换账本；读完后宣布可用。
 * 读账本、存盘排队本身在同目录别的文件里。
 * 没有特别的决定。
 */
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

/**
 * 这个函数把一件已接下的活记到会话名下，做完自动划掉。
 * 会话要停工时，靠这张单子等手上的活都做完。
 * 没有会话时什么都不做。
 * 会话的存盘通道还没接上时抛错。
 */
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

/**
 * 这个函数回答：要不要放弃没存好的改动，换到新请求的账本？
 * 确实要换、手上没大动作、还有没存的改动，才答应。
 * 举例：改了 3 次只存了 2 次，又要换账本 → 答 true，允许换。
 * 答 false 就是不用换或不能换。不会出错。
 */
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

/**
 * 这个函数在读到的账本显示到页面上后，宣布账本可用。
 * 它先对一遍：同一个仓库，同一轮，页面上的账和读到的一样。
 * 对上了，就把状态改成「读好了」，并算换了一本账本。
 * 对不上就什么都不做。不会出错。
 */
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
