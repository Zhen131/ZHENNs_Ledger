import type { LedgerRepository } from "@/platform/persistence";
import type {
  LedgerSessionFatalSignal,
  PersistenceTarget,
  PersistenceVersionState,
  ScheduledSnapshot,
} from "./usePersistentLedgerTypes";

type StopForImportRecoveryFatalDeps = {
  acceptingOperationsRef: { current: boolean };
  activePersistenceTargetRef: { current: PersistenceTarget };
  failedSnapshotRef: { current: ScheduledSnapshot | null };
  fatalOccurrenceRef: { current: number };
  generationRef: { current: number };
  hydratedRepositoryRef: { current: LedgerRepository | null };
  importAbortControllerRef: { current: AbortController | null };
  latestScheduledSnapshotRef: { current: ScheduledSnapshot | null };
  mountedRef: { current: boolean };
  pendingHydrationRef: {
    current: {
      repository: LedgerRepository;
      generation: number;
      serializedLedger: string;
    } | null;
  };
  persistenceVersionStateRef: { current: PersistenceVersionState };
  publishPersistenceVersionState: (nextState: PersistenceVersionState) => void;
  readOnlyRef: { current: boolean };
  retryAttemptRef: { current: unknown | null };
  sessionFatalSignalRef: { current: LedgerSessionFatalSignal | null };
  setIsReadOnly: (nextValue: boolean) => void;
  setLifecycleStatus: (nextValue: "quiescing") => void;
  setPersistenceError: (nextValue: string) => void;
  setSessionFatalSignal: (nextValue: LedgerSessionFatalSignal) => void;
};

export function doStopForImportRecoveryFatal(
  deps: StopForImportRecoveryFatalDeps,
  message: string,
): void {
  const {
    acceptingOperationsRef,
    activePersistenceTargetRef,
    failedSnapshotRef,
    fatalOccurrenceRef,
    generationRef,
    hydratedRepositoryRef,
    importAbortControllerRef,
    latestScheduledSnapshotRef,
    mountedRef,
    pendingHydrationRef,
    persistenceVersionStateRef,
    publishPersistenceVersionState,
    readOnlyRef,
    retryAttemptRef,
    sessionFatalSignalRef,
    setIsReadOnly,
    setLifecycleStatus,
    setPersistenceError,
    setSessionFatalSignal,
  } = deps;
      const fatalSession = activePersistenceTargetRef.current.session;
      if (!fatalSession || fatalSession.storageKind !== "ledger-file") {
        return;
      }
      const existingSignal = sessionFatalSignalRef.current;
      if (existingSignal?.sessionId === fatalSession.sessionId) {
        return;
      }

      acceptingOperationsRef.current = false;
      readOnlyRef.current = true;
      importAbortControllerRef.current?.abort(
        "Ledger import recovery was blocked",
      );
      generationRef.current += 1;
      latestScheduledSnapshotRef.current = null;
      failedSnapshotRef.current = null;
      retryAttemptRef.current = null;
      pendingHydrationRef.current = null;
      hydratedRepositoryRef.current = null;
      const currentVersionState = persistenceVersionStateRef.current;
      publishPersistenceVersionState({
        ...currentVersionState,
        persistenceStatus: "error",
      });
      fatalOccurrenceRef.current += 1;
      const signal = Object.freeze({
        code: "IMPORT_RECOVERY_BLOCKED" as const,
        occurrence: fatalOccurrenceRef.current,
        sessionId: fatalSession.sessionId,
        sessionGeneration: fatalSession.generation,
      });
      sessionFatalSignalRef.current = signal;

      if (mountedRef.current) {
        setIsReadOnly(true);
        setPersistenceError(message);
        setLifecycleStatus("quiescing");
        setSessionFatalSignal(signal);
      }
}
