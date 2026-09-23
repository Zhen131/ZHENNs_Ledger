import type { LedgerSession } from "@/platform/persistence";
import type {
  LedgerFileAccessController,
  LedgerFileAccessErrorCode,
} from "@/app/file-access";
import type {
  Dispatch,
  FormEvent,
  RefObject,
  SetStateAction,
} from "react";
import type { AccessPath } from "./LedgerAccessGateTypes";
import type { useLanguage } from "@/ui";
import { validatePassphrase } from "@/platform/encryption";
import { LEDGER_FILE_ACCESS_ERROR_CODES } from "@/app/file-access";
import { getFileAccessErrorMessage } from "./LedgerAccessGateHelpers";

type SubmitFileCreateDeps = {
  beginOperation: () => number;
  confirmation: string;
  enterUnlockedSession: (session: LedgerSession) => void;
  fileAccessController: LedgerFileAccessController;
  finishOperation: (operation: number) => void;
  isCurrentOperation: (operation: number) => boolean;
  operationRef: RefObject<boolean>;
  passphrase: string;
  setAccessPath: Dispatch<SetStateAction<AccessPath>>;
  setConfirmation: Dispatch<SetStateAction<string>>;
  setFormError: Dispatch<SetStateAction<string>>;
  setIsSubmitting: Dispatch<SetStateAction<boolean>>;
  setPassphrase: Dispatch<SetStateAction<string>>;
  t: ReturnType<typeof useLanguage>["t"];
};

export async function doSubmitFileCreate(
  deps: SubmitFileCreateDeps,
  event: FormEvent<HTMLFormElement>,
) {
  const {
    beginOperation,
    confirmation,
    enterUnlockedSession,
    fileAccessController,
    finishOperation,
    isCurrentOperation,
    operationRef,
    passphrase,
    setAccessPath,
    setConfirmation,
    setFormError,
    setIsSubmitting,
    setPassphrase,
    t,
  } = deps;
    event.preventDefault();
    if (operationRef.current) {
      return;
    }
    if (passphrase !== confirmation) {
      setFormError(t("access.error.passphraseMismatch"));
      return;
    }
    if (!validatePassphrase(passphrase).ok) {
      setFormError(t("access.error.passphraseLength"));
      return;
    }

    const operation = beginOperation();
    setIsSubmitting(true);
    setFormError("");
    const result = await fileAccessController.create(passphrase);

    if (isCurrentOperation(operation)) {
      setPassphrase("");
      setConfirmation("");
      if (result.status === "unlocked") {
        enterUnlockedSession(result.session);
      } else if (
        result.status === "error" &&
        result.code === LEDGER_FILE_ACCESS_ERROR_CODES.CANCELLED
      ) {
        setAccessPath("choice");
      } else if (result.status === "error") {
        setFormError(getFileAccessErrorMessage(result.code, t));
      }
    }
    finishOperation(operation);
}

type SelectFileToOpenDeps = {
  beginOperation: () => number;
  fileAccessController: LedgerFileAccessController;
  finishOperation: (operation: number) => void;
  isCurrentOperation: (operation: number) => boolean;
  operationRef: RefObject<boolean>;
  setAccessPath: Dispatch<SetStateAction<AccessPath>>;
  setFormError: Dispatch<SetStateAction<string>>;
  setIsSubmitting: Dispatch<SetStateAction<boolean>>;
  t: ReturnType<typeof useLanguage>["t"];
};

export async function doSelectFileToOpen(
  deps: SelectFileToOpenDeps,
) {
  const {
    beginOperation,
    fileAccessController,
    finishOperation,
    isCurrentOperation,
    operationRef,
    setAccessPath,
    setFormError,
    setIsSubmitting,
    t,
  } = deps;
    if (operationRef.current) {
      return;
    }
    const operation = beginOperation();
    setIsSubmitting(true);
    setFormError("");
    const result = await fileAccessController.selectExisting();

    if (isCurrentOperation(operation)) {
      if (result.ok) {
        setAccessPath("file-open-unlock");
      } else if (
        result.code !== LEDGER_FILE_ACCESS_ERROR_CODES.CANCELLED
      ) {
        setFormError(getFileAccessErrorMessage(result.code, t));
      }
    }
    finishOperation(operation);
}

type RequestRememberedConnectionDeps = {
  beginOperation: () => number;
  fileAccessController: LedgerFileAccessController;
  finishOperation: (operation: number) => void;
  isCurrentOperation: (operation: number) => boolean;
  operationRef: RefObject<boolean>;
  setAccessPath: Dispatch<SetStateAction<AccessPath>>;
  setFormError: Dispatch<SetStateAction<string>>;
  setIsSubmitting: Dispatch<SetStateAction<boolean>>;
  setReconnectError: Dispatch<SetStateAction<LedgerFileAccessErrorCode | null>>;
};

export async function doRequestRememberedConnection(
  deps: RequestRememberedConnectionDeps,
) {
  const {
    beginOperation,
    fileAccessController,
    finishOperation,
    isCurrentOperation,
    operationRef,
    setAccessPath,
    setFormError,
    setIsSubmitting,
    setReconnectError,
  } = deps;
    if (operationRef.current) {
      return;
    }
    const operation = beginOperation();
    setIsSubmitting(true);
    setFormError("");
    const result =
      await fileAccessController.requestRememberedPermission();

    if (isCurrentOperation(operation)) {
      if (result.status === "ready") {
        setReconnectError(null);
        setAccessPath("file-open-unlock");
      } else if (result.status === "permission-prompt") {
        setAccessPath("file-reconnect-prompt");
      } else if (result.status === "error") {
        setReconnectError(result.code);
        setAccessPath("file-reconnect-error");
      }
    }
    finishOperation(operation);
}

type ReselectRememberedConnectionDeps = {
  beginOperation: () => number;
  fileAccessController: LedgerFileAccessController;
  finishOperation: (operation: number) => void;
  isCurrentOperation: (operation: number) => boolean;
  operationRef: RefObject<boolean>;
  setAccessPath: Dispatch<SetStateAction<AccessPath>>;
  setFormError: Dispatch<SetStateAction<string>>;
  setIsSubmitting: Dispatch<SetStateAction<boolean>>;
  setReconnectError: Dispatch<SetStateAction<LedgerFileAccessErrorCode | null>>;
};

export async function doReselectRememberedConnection(
  deps: ReselectRememberedConnectionDeps,
) {
  const {
    beginOperation,
    fileAccessController,
    finishOperation,
    isCurrentOperation,
    operationRef,
    setAccessPath,
    setFormError,
    setIsSubmitting,
    setReconnectError,
  } = deps;
    if (operationRef.current) {
      return;
    }
    const operation = beginOperation();
    setIsSubmitting(true);
    setFormError("");
    const result =
      await fileAccessController.reselectRememberedConnection();

    if (isCurrentOperation(operation)) {
      if (result.ok) {
        setReconnectError(null);
        setAccessPath("file-open-unlock");
      } else if (
        result.code !== LEDGER_FILE_ACCESS_ERROR_CODES.CANCELLED
      ) {
        setReconnectError(result.code);
        setAccessPath("file-reconnect-error");
      }
    }
    finishOperation(operation);
}

type ForgetRememberedConnectionDeps = {
  beginOperation: () => number;
  fileAccessController: LedgerFileAccessController;
  finishOperation: (operation: number) => void;
  isCurrentOperation: (operation: number) => boolean;
  operationRef: RefObject<boolean>;
  setAccessPath: Dispatch<SetStateAction<AccessPath>>;
  setConfirmation: Dispatch<SetStateAction<string>>;
  setFormError: Dispatch<SetStateAction<string>>;
  setIsSubmitting: Dispatch<SetStateAction<boolean>>;
  setPassphrase: Dispatch<SetStateAction<string>>;
  setReconnectError: Dispatch<SetStateAction<LedgerFileAccessErrorCode | null>>;
  setRecoveryId: Dispatch<SetStateAction<string | null>>;
  t: ReturnType<typeof useLanguage>["t"];
};

export async function doForgetRememberedConnection(
  deps: ForgetRememberedConnectionDeps,
) {
  const {
    beginOperation,
    fileAccessController,
    finishOperation,
    isCurrentOperation,
    operationRef,
    setAccessPath,
    setConfirmation,
    setFormError,
    setIsSubmitting,
    setPassphrase,
    setReconnectError,
    setRecoveryId,
    t,
  } = deps;
    if (operationRef.current) {
      return;
    }
    const operation = beginOperation();
    setIsSubmitting(true);
    setFormError("");
    try {
      await fileAccessController.forgetRememberedConnection();
      if (isCurrentOperation(operation)) {
        setPassphrase("");
        setConfirmation("");
        setRecoveryId(null);
        setReconnectError(null);
        setAccessPath("choice");
      }
    } catch {
      if (isCurrentOperation(operation)) {
        setFormError(
          t("access.error.forgetConnection"),
        );
      }
    }
    finishOperation(operation);
}

type SubmitFileUnlockDeps = {
  beginOperation: () => number;
  enterUnlockedSession: (session: LedgerSession) => void;
  fileAccessController: LedgerFileAccessController;
  finishOperation: (operation: number) => void;
  isCurrentOperation: (operation: number) => boolean;
  operationRef: RefObject<boolean>;
  passphrase: string;
  setAccessPath: Dispatch<SetStateAction<AccessPath>>;
  setFormError: Dispatch<SetStateAction<string>>;
  setIsSubmitting: Dispatch<SetStateAction<boolean>>;
  setPassphrase: Dispatch<SetStateAction<string>>;
  setRecoveryId: Dispatch<SetStateAction<string | null>>;
  t: ReturnType<typeof useLanguage>["t"];
};

export async function doSubmitFileUnlock(
  deps: SubmitFileUnlockDeps,
  event: FormEvent<HTMLFormElement>,
) {
  const {
    beginOperation,
    enterUnlockedSession,
    fileAccessController,
    finishOperation,
    isCurrentOperation,
    operationRef,
    passphrase,
    setAccessPath,
    setFormError,
    setIsSubmitting,
    setPassphrase,
    setRecoveryId,
    t,
  } = deps;
    event.preventDefault();
    if (operationRef.current) {
      return;
    }

    const operation = beginOperation();
    setIsSubmitting(true);
    setFormError("");
    const result =
      await fileAccessController.unlockSelected(passphrase);

    if (isCurrentOperation(operation)) {
      setPassphrase("");
      if (result.status === "unlocked") {
        enterUnlockedSession(result.session);
      } else if (result.status === "recovery-required") {
        setRecoveryId(result.recoveryId);
        setAccessPath("file-recovery");
      } else {
        setFormError(getFileAccessErrorMessage(result.code, t));
      }
    }
    finishOperation(operation);
}

type ConfirmFileRecoveryDeps = {
  beginOperation: () => number;
  enterUnlockedSession: (session: LedgerSession) => void;
  fileAccessController: LedgerFileAccessController;
  finishOperation: (operation: number) => void;
  isCurrentOperation: (operation: number) => boolean;
  operationRef: RefObject<boolean>;
  recoveryId: string | null;
  setFormError: Dispatch<SetStateAction<string>>;
  setIsSubmitting: Dispatch<SetStateAction<boolean>>;
  setRecoveryId: Dispatch<SetStateAction<string | null>>;
  t: ReturnType<typeof useLanguage>["t"];
};

export async function doConfirmFileRecovery(
  deps: ConfirmFileRecoveryDeps,
) {
  const {
    beginOperation,
    enterUnlockedSession,
    fileAccessController,
    finishOperation,
    isCurrentOperation,
    operationRef,
    recoveryId,
    setFormError,
    setIsSubmitting,
    setRecoveryId,
    t,
  } = deps;
    if (operationRef.current || recoveryId === null) {
      return;
    }
    const operation = beginOperation();
    setIsSubmitting(true);
    setFormError("");
    try {
      const result =
        await fileAccessController.confirmRecovery(recoveryId);

      if (isCurrentOperation(operation)) {
        if (result.status === "unlocked") {
          setRecoveryId(null);
          enterUnlockedSession(result.session);
        } else if (result.status === "error") {
          setFormError(getFileAccessErrorMessage(result.code, t));
        }
      }
    } catch {
      if (isCurrentOperation(operation)) {
        setFormError(
          getFileAccessErrorMessage(
            LEDGER_FILE_ACCESS_ERROR_CODES.RECOVERY_FAILED,
            t,
          ),
        );
      }
    } finally {
      finishOperation(operation);
    }
}
