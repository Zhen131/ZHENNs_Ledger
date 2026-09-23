import type { LedgerSession } from "@/platform/persistence";
import type { LedgerFileAccessController } from "@/app/file-access";
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
