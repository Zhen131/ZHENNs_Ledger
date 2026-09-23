import type { RefObject } from "react";
import type {
  LedgerSession,
} from "@/platform/persistence";
import type { SessionPersistenceBinding } from "./usePersistentLedgerTypes";

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
