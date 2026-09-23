import type { LedgerAccessController } from "@/platform/legacy";
import type {
  Dispatch,
  RefObject,
  SetStateAction,
} from "react";
import type { LedgerSession } from "@/platform/persistence";
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
