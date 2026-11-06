/**
 * 这个文件管账本文件存取时共用的小工具。
 * 包括做错误、生成编号、检查导入还在不在进行。
 * 它不管存取本身，那在 ledgerFileRepository.ts。
 * 没有特别的决定。
 */

import { LedgerFileAdapterError } from "./ledgerFileHandleAdapterContract";
import {
  LEDGER_FILE_REPOSITORY_ERROR_CODES,
  LedgerFileRepositoryError,
} from "./ledgerFileRepositoryContract";

/**
 * 这个函数给一次保存做一个标记。
 * 包括哪个文件、基于哪一代、要存的内容。
 * 举例：同一个文件、同一代、同样内容 → 答一模一样的标记。
 */
export function createIntentKey(
  fileId: string,
  baseRevisionId: string,
  serializedCandidate: string,
): string {
  return JSON.stringify([
    fileId,
    baseRevisionId,
    serializedCandidate,
  ]);
}

/**
 * 这个函数把读写文件的错，换成账本文件存取的错。
 * 举例：复读那一步出错 → 答 `LEDGER_FILE_READBACK_FAILED`；别的 → 答 `LEDGER_FILE_WRITE_FAILED`。
 */
export function mapAdapterWriteError(error: unknown): LedgerFileRepositoryError {
  if (
    error instanceof LedgerFileAdapterError &&
    error.stage === "readback"
  ) {
    return new LedgerFileRepositoryError(
      LEDGER_FILE_REPOSITORY_ERROR_CODES.READBACK_FAILED,
      "Ledger file was closed but could not be verified by readback",
      error,
    );
  }

  return new LedgerFileRepositoryError(
    LEDGER_FILE_REPOSITORY_ERROR_CODES.WRITE_FAILED,
    "Ledger file write or close failed",
    error,
  );
}

/** 这个函数做一条「文件被外面改过」的错误，代码 `LEDGER_FILE_EXTERNAL_CHANGE`。 */
export function externalChangeError(
  message: string,
  cause?: unknown,
): LedgerFileRepositoryError {
  return new LedgerFileRepositoryError(
    LEDGER_FILE_REPOSITORY_ERROR_CODES.EXTERNAL_CHANGE,
    message,
    cause,
  );
}

/** 这个函数做一条「清空授权无效、过期或已用过」的错误。 */
export function clearAuthorizationError(): LedgerFileRepositoryError {
  return new LedgerFileRepositoryError(
    LEDGER_FILE_REPOSITORY_ERROR_CODES.CLEAR_AUTHORIZATION_FAILED,
    "Ready ledger clear authorization is invalid, stale, or already used",
  );
}

/**
 * 这个函数做一条导入授权出问题的错误，说明可以换。
 * 问题指无效、过期、被取消或已用过。
 */
export function importAuthorizationError(
  message =
    "Ready ledger import authorization is invalid, stale, cancelled, or already used",
): LedgerFileRepositoryError {
  return new LedgerFileRepositoryError(
    LEDGER_FILE_REPOSITORY_ERROR_CODES.IMPORT_AUTHORIZATION_FAILED,
    message,
  );
}

/** 这个函数做一条错误：导入失败后，没能安全恢复原来的文件。 */
export function importRecoveryBlockedError(
  cause: unknown,
): LedgerFileRepositoryError {
  return new LedgerFileRepositoryError(
    LEDGER_FILE_REPOSITORY_ERROR_CODES.IMPORT_RECOVERY_BLOCKED,
    "Ledger-file import could not safely restore and verify the exact pre-import C",
    cause,
  );
}

/**
 * 这个函数确认导入还没被取消；已取消就抛导入授权错误。
 * 举例：取消信号已触发 → 抛 `LEDGER_FILE_IMPORT_AUTHORIZATION_FAILED`。
 */
export function assertImportActive(signal: AbortSignal): void {
  if (signal.aborted) {
    throw importAuthorizationError(
      "Ready ledger import was cancelled by its bound lifecycle",
    );
  }
}

/**
 * 这个函数生成一个新的随机编号（UUID）。
 * 举例：调用两次 → 答两个不同的编号。
 */
export function defaultGenerateId(): string {
  return globalThis.crypto.randomUUID();
}
