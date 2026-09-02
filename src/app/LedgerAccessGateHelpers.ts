import {
  LEDGER_ACCESS_ERROR_CODES,
  type LedgerAccessErrorCode,
} from "@/platform/legacy";
import {
  LEDGER_FILE_ACCESS_ERROR_CODES,
  type LedgerFileAccessController,
  type LedgerFileAccessErrorCode,
} from "./ledgerFileAccessController";
import { useLanguage } from "@/ui";
import type { PendingSessionCompletion } from "./LedgerAccessGateTypes";

export const pendingSessionCompletions = new WeakMap<
  LedgerFileAccessController,
  PendingSessionCompletion
>();
export function getAccessErrorMessage(
  code: LedgerAccessErrorCode,
  t: ReturnType<typeof useLanguage>["t"],
): string {
  switch (code) {
    case LEDGER_ACCESS_ERROR_CODES.READ_FAILED:
      return t("access.legacyError.readFailed");
    case LEDGER_ACCESS_ERROR_CODES.UNSUPPORTED_FORMAT:
      return t("access.legacyError.unsupportedFormat");
    case LEDGER_ACCESS_ERROR_CODES.INVALID_ENVELOPE:
      return t("access.legacyError.invalidEnvelope");
    default:
      return t("access.legacyError.default");
  }
}

export function getFileAccessErrorMessage(
  code: LedgerFileAccessErrorCode,
  t: ReturnType<typeof useLanguage>["t"],
): string {
  switch (code) {
    case LEDGER_FILE_ACCESS_ERROR_CODES.PICKER_UNAVAILABLE:
      return t("access.fileError.pickerUnavailable");
    case LEDGER_FILE_ACCESS_ERROR_CODES.INVALID_EXTENSION:
      return t("access.fileError.invalidExtension");
    case LEDGER_FILE_ACCESS_ERROR_CODES.NON_EMPTY_CREATE_TARGET:
      return t("access.fileError.nonEmptyCreateTarget");
    case LEDGER_FILE_ACCESS_ERROR_CODES.UNSUPPORTED_FILE_VERSION:
      return t("access.fileError.unsupportedFileVersion");
    case LEDGER_FILE_ACCESS_ERROR_CODES.UNSUPPORTED_LEDGER_SCHEMA:
      return t("access.fileError.unsupportedLedgerSchema");
    case LEDGER_FILE_ACCESS_ERROR_CODES.INVALID_FILE:
      return t("access.fileError.invalidFile");
    case LEDGER_FILE_ACCESS_ERROR_CODES.UNLOCK_FAILED:
      return t("access.fileError.unlockFailed");
    case LEDGER_FILE_ACCESS_ERROR_CODES.NO_SELECTION:
      return t("access.fileError.noSelection");
    case LEDGER_FILE_ACCESS_ERROR_CODES.FILE_IN_USE:
      return t("access.fileError.fileInUse");
    case LEDGER_FILE_ACCESS_ERROR_CODES.COORDINATION_UNSUPPORTED:
      return t("access.fileError.coordinationUnsupported");
    case LEDGER_FILE_ACCESS_ERROR_CODES.COORDINATION_FAILED:
      return t("access.fileError.coordinationFailed");
    case LEDGER_FILE_ACCESS_ERROR_CODES.RECOVERY_NOT_FOUND:
      return t("access.fileError.recoveryNotFound");
    case LEDGER_FILE_ACCESS_ERROR_CODES.RECOVERY_FAILED:
      return t("access.fileError.recoveryFailed");
    case LEDGER_FILE_ACCESS_ERROR_CODES.EXTERNAL_CHANGE:
      return t("access.fileError.externalChange");
    case LEDGER_FILE_ACCESS_ERROR_CODES.CONNECTION_INVALID:
      return t("access.fileError.connectionInvalid");
    case LEDGER_FILE_ACCESS_ERROR_CODES.CONNECTION_SAVE_FAILED:
      return t("access.fileError.connectionSaveFailed");
    case LEDGER_FILE_ACCESS_ERROR_CODES.PERMISSION_DENIED:
      return t("access.fileError.permissionDenied");
    case LEDGER_FILE_ACCESS_ERROR_CODES.PERMISSION_REQUIRED:
      return t("access.fileError.permissionRequired");
    case LEDGER_FILE_ACCESS_ERROR_CODES.RECONNECT_FAILED:
      return t("access.fileError.reconnectFailed");
    case LEDGER_FILE_ACCESS_ERROR_CODES.WRONG_RECONNECT_FILE:
      return t("access.fileError.wrongReconnectFile");
    case LEDGER_FILE_ACCESS_ERROR_CODES.CREATE_FAILED:
      return t("access.fileError.createFailed");
    case LEDGER_FILE_ACCESS_ERROR_CODES.CANCELLED:
      return "";
    default:
      return t("access.fileError.default");
  }
}
