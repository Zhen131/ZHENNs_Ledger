import type { LedgerAccessController } from "@/platform/legacy";
import type {
  Dispatch,
  RefObject,
  SetStateAction,
} from "react";
import type {
  LedgerSession,
  SessionQuiesceReason,
} from "@/platform/persistence";
import type {
  LedgerFileAccessController,
  LedgerFileAccessErrorCode,
} from "@/app/file-access";
import type {
  AccessPath,
  AccessState,
} from "./LedgerAccessGateTypes";
import { pendingSessionCompletions } from "./LedgerAccessGateHelpers";
import { LEDGER_ACCESS_ERROR_CODES } from "@/platform/legacy";
import type {
  LedgerSessionFatalSignal,
  PersistentLedgerState,
} from "@/app/persistence";

type InitializeDeps = {
  accessController: LedgerAccessController;
  activeSessionRef: RefObject<LedgerSession | null>;
  fileAccessController: LedgerFileAccessController;
  mountedRef: RefObject<boolean>;
  operationGenerationRef: RefObject<number>;
  retryReleaseRef: RefObject<(() => Promise<void>) | null>;
  setAccessPath: Dispatch<SetStateAction<AccessPath>>;
  setAccessState: Dispatch<SetStateAction<AccessState>>;
  setFormError: Dispatch<SetStateAction<string>>;
  setReconnectError: Dispatch<SetStateAction<LedgerFileAccessErrorCode | null>>;
};

export async function doInitialize(
  deps: InitializeDeps,
) {
  const {
    accessController,
    activeSessionRef,
    fileAccessController,
    mountedRef,
    operationGenerationRef,
    retryReleaseRef,
    setAccessPath,
    setAccessState,
    setFormError,
    setReconnectError,
  } = deps;
    const operation = operationGenerationRef.current + 1;
    operationGenerationRef.current = operation;
    setAccessState({ status: "checking" });
    setFormError("");
    setReconnectError(null);

    const interruptedCompletion =
      pendingSessionCompletions.get(fileAccessController);
    if (interruptedCompletion) {
      activeSessionRef.current = interruptedCompletion.session;
      retryReleaseRef.current = interruptedCompletion.retry;
      try {
        await interruptedCompletion.completion;
      } catch {
        if (
          mountedRef.current &&
          operationGenerationRef.current === operation
        ) {
          setAccessState({
            status: "lock-error",
            fatal: interruptedCompletion.fatal,
          });
        }
        return;
      }
      if (
        !mountedRef.current ||
        operationGenerationRef.current !== operation
      ) {
        return;
      }
      if (
        pendingSessionCompletions.get(fileAccessController) ===
        interruptedCompletion
      ) {
        pendingSessionCompletions.delete(fileAccessController);
      }
      activeSessionRef.current = null;
      retryReleaseRef.current = null;
      if (interruptedCompletion.fatal) {
        setAccessPath("choice");
        setAccessState({ status: "fatal-closed" });
        return;
      }
    }

    const reconnect =
      await fileAccessController.inspectRememberedConnection();
    if (
      !mountedRef.current ||
      operationGenerationRef.current !== operation
    ) {
      return;
    }

    const legacy = await accessController.inspect();
    if (
      !mountedRef.current ||
      operationGenerationRef.current !== operation
    ) {
      return;
    }

    if (
      legacy.status === "unlock-required" ||
      legacy.status === "error"
    ) {
      setAccessState({
        status: "error",
        code:
          legacy.status === "error"
            ? legacy.code
            : LEDGER_ACCESS_ERROR_CODES.UNSUPPORTED_FORMAT,
      });
      setAccessPath("legacy-retired");
      return;
    }
    setAccessState(legacy);
    if (reconnect.status === "ready") {
      setAccessPath("file-open-unlock");
    } else if (reconnect.status === "permission-prompt") {
      setAccessPath("file-reconnect-prompt");
    } else if (reconnect.status === "error") {
      setReconnectError(reconnect.code);
      setAccessPath("file-reconnect-error");
    } else {
      setAccessPath("choice");
    }
}

type GateLifecycleEffectDeps = {
  activeSessionRef: RefObject<LedgerSession | null>;
  fileAccessController: LedgerFileAccessController;
  finalLockRef: RefObject<{
    session: LedgerSession;
    promise: Promise<void>;
  } | null>;
  initialize: () => Promise<void>;
  mountedRef: RefObject<boolean>;
  operationGenerationRef: RefObject<number>;
  operationRef: RefObject<boolean>;
  sessionDrainRef: RefObject<{
    session: LedgerSession;
    drain: PersistentLedgerState["drainForSessionQuiesce"];
  } | null>;
  sessionLifecycleStarterRef: RefObject<(args: {
      session: LedgerSession;
      drain: PersistentLedgerState["drainForSessionQuiesce"];
      reason: SessionQuiesceReason;
      fatal?: boolean;
    }) => Promise<void>>;
  setAccessPath: Dispatch<SetStateAction<AccessPath>>;
  setConfirmation: Dispatch<SetStateAction<string>>;
  setIsSubmitting: Dispatch<SetStateAction<boolean>>;
  setPassphrase: Dispatch<SetStateAction<string>>;
  setReconnectError: Dispatch<SetStateAction<LedgerFileAccessErrorCode | null>>;
  setRecoveryId: Dispatch<SetStateAction<string | null>>;
};

export function runGateLifecycleEffect(
  deps: GateLifecycleEffectDeps,
) {
  const {
    activeSessionRef,
    fileAccessController,
    finalLockRef,
    initialize,
    mountedRef,
    operationGenerationRef,
    operationRef,
    sessionDrainRef,
    sessionLifecycleStarterRef,
    setAccessPath,
    setConfirmation,
    setIsSubmitting,
    setPassphrase,
    setReconnectError,
    setRecoveryId,
  } = deps;
    mountedRef.current = true;
    operationRef.current = false;
    setIsSubmitting(false);
    setPassphrase("");
    setConfirmation("");
    setRecoveryId(null);
    setReconnectError(null);
    setAccessPath("choice");
    void initialize();

    return () => {
      mountedRef.current = false;
      operationGenerationRef.current += 1;
      operationRef.current = false;
      const activeSession = activeSessionRef.current;
      const registeredDrain = sessionDrainRef.current;
      const finalLock = finalLockRef.current;
      if (
        activeSession &&
        registeredDrain?.session === activeSession &&
        finalLock?.session !== activeSession
      ) {
        void sessionLifecycleStarterRef.current({
          session: activeSession,
          drain: registeredDrain.drain,
          reason: "route-leave",
        });
      } else if (!activeSession) {
        try {
          fileAccessController.cancelPendingSelection();
        } catch {
          // Cleanup remains fail-closed if a custom controller reports failure.
        }
      }
    };
}

type FinishSessionLifecycleDeps = {
  activeSessionRef: RefObject<LedgerSession | null>;
  finalLockRef: RefObject<{
    session: LedgerSession;
    promise: Promise<void>;
  } | null>;
  invalidateOperations: () => void;
  setAccessState: Dispatch<SetStateAction<AccessState>>;
  setConfirmation: Dispatch<SetStateAction<string>>;
  setFormError: Dispatch<SetStateAction<string>>;
  setPassphrase: Dispatch<SetStateAction<string>>;
  setRecoveryId: Dispatch<SetStateAction<string | null>>;
  startSessionLifecycle: ({ session, drain, reason, fatal, }: { session: LedgerSession; drain: PersistentLedgerState["drainForSessionQuiesce"]; reason: SessionQuiesceReason; fatal?: boolean; }) => Promise<void>;
};

export function doFinishSessionLifecycle(
  deps: FinishSessionLifecycleDeps,
  drain: PersistentLedgerState["drainForSessionQuiesce"],
  reason: SessionQuiesceReason,
): Promise<void> {
  const {
    activeSessionRef,
    finalLockRef,
    invalidateOperations,
    setAccessState,
    setConfirmation,
    setFormError,
    setPassphrase,
    setRecoveryId,
    startSessionLifecycle,
  } = deps;
    const session = activeSessionRef.current;
    if (!session) {
      return Promise.resolve();
    }
    const existing = finalLockRef.current;
    if (existing?.session === session) {
      return existing.promise;
    }

    invalidateOperations();
    setPassphrase("");
    setConfirmation("");
    setRecoveryId(null);
    setFormError("");

    setAccessState({ status: "locking", fatal: false });
    return startSessionLifecycle({
      session,
      drain,
      reason,
    });
}

type FinishFatalSessionLifecycleDeps = {
  activeSessionRef: RefObject<LedgerSession | null>;
  finalLockRef: RefObject<{
    session: LedgerSession;
    promise: Promise<void>;
  } | null>;
  invalidateOperations: () => void;
  setAccessState: Dispatch<SetStateAction<AccessState>>;
  setConfirmation: Dispatch<SetStateAction<string>>;
  setFormError: Dispatch<SetStateAction<string>>;
  setPassphrase: Dispatch<SetStateAction<string>>;
  setReconnectError: Dispatch<SetStateAction<LedgerFileAccessErrorCode | null>>;
  setRecoveryId: Dispatch<SetStateAction<string | null>>;
  startSessionLifecycle: ({ session, drain, reason, fatal, }: { session: LedgerSession; drain: PersistentLedgerState["drainForSessionQuiesce"]; reason: SessionQuiesceReason; fatal?: boolean; }) => Promise<void>;
};

export function doFinishFatalSessionLifecycle(
  deps: FinishFatalSessionLifecycleDeps,
  drain: PersistentLedgerState["drainForSessionQuiesce"],
  signal: LedgerSessionFatalSignal,
): Promise<void> {
  const {
    activeSessionRef,
    finalLockRef,
    invalidateOperations,
    setAccessState,
    setConfirmation,
    setFormError,
    setPassphrase,
    setReconnectError,
    setRecoveryId,
    startSessionLifecycle,
  } = deps;
    const session = activeSessionRef.current;
    if (
      !session ||
      signal.code !== "IMPORT_RECOVERY_BLOCKED" ||
      signal.sessionId !== session.sessionId ||
      signal.sessionGeneration !== session.generation
    ) {
      return Promise.resolve();
    }
    const existing = finalLockRef.current;
    if (existing?.session === session) {
      return existing.promise;
    }

    invalidateOperations();
    setPassphrase("");
    setConfirmation("");
    setRecoveryId(null);
    setReconnectError(null);
    setFormError("");
    setAccessState({ status: "locking", fatal: true });
    return startSessionLifecycle({
      session,
      drain,
      reason: "immediate-lock",
      fatal: true,
    });
}

type RetryFailedSessionReleaseDeps = {
  accessState: AccessState;
  activeSessionRef: RefObject<LedgerSession | null>;
  fileAccessController: LedgerFileAccessController;
  initialize: () => Promise<void>;
  mountedRef: RefObject<boolean>;
  retryReleaseRef: RefObject<(() => Promise<void>) | null>;
  sessionDrainRef: RefObject<{
    session: LedgerSession;
    drain: PersistentLedgerState["drainForSessionQuiesce"];
  } | null>;
  setAccessPath: Dispatch<SetStateAction<AccessPath>>;
  setAccessState: Dispatch<SetStateAction<AccessState>>;
};

export async function doRetryFailedSessionRelease(
  deps: RetryFailedSessionReleaseDeps,
) {
  const {
    accessState,
    activeSessionRef,
    fileAccessController,
    initialize,
    mountedRef,
    retryReleaseRef,
    sessionDrainRef,
    setAccessPath,
    setAccessState,
  } = deps;
    const release = retryReleaseRef.current;
    const session = activeSessionRef.current;
    const fatal =
      accessState.status === "lock-error" && accessState.fatal;
    if (!release || !session) {
      return;
    }
    setAccessState({ status: "locking", fatal });
    try {
      await release();
      const pending =
        pendingSessionCompletions.get(fileAccessController);
      if (pending?.session === session) {
        pendingSessionCompletions.delete(fileAccessController);
      }
      if (activeSessionRef.current === session) {
        activeSessionRef.current = null;
        sessionDrainRef.current = null;
        retryReleaseRef.current = null;
        if (mountedRef.current) {
          if (fatal) {
            setAccessPath("choice");
            setAccessState({ status: "fatal-closed" });
          } else {
            void initialize();
          }
        }
      }
    } catch {
      if (mountedRef.current) {
        setAccessState({ status: "lock-error", fatal });
      }
    }
}
