/**
 * 这个文件放进账本前那道检查的两个小帮手。
 * 一个记着没收完尾的会话，一个把错误码翻成给用户看的话。
 * 不显然的决定：结构版本不对的提示里，版本号不写死。
 * 2026-09-07 提交 2a61870 起这样做。
 */
import { SUPPORTED_LEDGER_SCHEMA_VERSION } from "@/platform/files";
import {
  LEDGER_FILE_ACCESS_ERROR_CODES,
  type LedgerFileAccessController,
  type LedgerFileAccessErrorCode,
} from "@/app/file-access";
import type { Translate } from "@/ui";
import type { PendingSessionCompletion } from "./LedgerAccessGateTypes";

/**
 * 每个文件打开器名下还没收完尾的会话。
 * 页面重新挂上时，靠它接着等上一次的收尾。
 */
export const pendingSessionCompletions = new WeakMap<
  LedgerFileAccessController,
  PendingSessionCompletion
>();
/**
 * 这个函数把打开账本文件的错误码翻成给用户看的一句话。
 * 举例：`FILE_IN_USE` → 答「这个实际账本已被另一个页面……占用」那句。
 * 用户自己取消的（`CANCELLED`）答空字符串，不显示错误。
 * 认不出的错误码答一句通用的话。不会出错。
 */
export function getFileAccessErrorMessage(
  code: LedgerFileAccessErrorCode,
  t: Translate,
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
      // 为什么从定义处读：下次升结构版本，这句话自动跟着变。
      // 免得悄悄写着一个已退役的版本。2026-09-07 提交 2a61870 写下这个理由。
      return (
        t("access.fileError.unsupportedLedgerSchemaPrefix") +
        SUPPORTED_LEDGER_SCHEMA_VERSION +
        t("access.fileError.unsupportedLedgerSchemaMiddle") +
        SUPPORTED_LEDGER_SCHEMA_VERSION +
        t("access.fileError.unsupportedLedgerSchemaSuffix")
      );
    case LEDGER_FILE_ACCESS_ERROR_CODES.RETIRED_LEDGER_SCHEMA_V4:
      return t("access.fileError.retiredLedgerSchemaV4");
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
