/**
 * 这个文件管账本文件存取这一层的错误代码。
 * 和创建它时要给的东西。
 * 它不管具体怎么存取，那在 ledgerFileRepository.ts。
 * 没有特别的决定。
 */

import type { LedgerFileSessionLease } from "./ledgerFileSessionLease";
import type { CryptoProvider } from "@/platform/encryption";

/**
 * 账本文件存取可能报的错误代码。
 * 例如密码不对、文件被外面改过、写失败、复读失败。
 */
export const LEDGER_FILE_REPOSITORY_ERROR_CODES = {
  INVALID_CANDIDATE: "LEDGER_FILE_INVALID_CANDIDATE",
  INVALID_FILE: "LEDGER_FILE_INVALID_FILE",
  AUTHENTICATION_FAILED: "LEDGER_FILE_AUTHENTICATION_FAILED",
  FILE_ID_MISMATCH: "LEDGER_FILE_ID_MISMATCH",
  REVISION_MISMATCH: "LEDGER_FILE_REVISION_MISMATCH",
  EXTERNAL_CHANGE: "LEDGER_FILE_EXTERNAL_CHANGE",
  WRITE_FAILED: "LEDGER_FILE_WRITE_FAILED",
  READBACK_FAILED: "LEDGER_FILE_READBACK_FAILED",
  CLEAR_UNSUPPORTED: "LEDGER_FILE_CLEAR_UNSUPPORTED",
  CLEAR_AUTHORIZATION_FAILED:
    "LEDGER_FILE_CLEAR_AUTHORIZATION_FAILED",
  IMPORT_AUTHORIZATION_FAILED:
    "LEDGER_FILE_IMPORT_AUTHORIZATION_FAILED",
  IMPORT_FAILED_BASE_RESTORED:
    "LEDGER_FILE_IMPORT_FAILED_BASE_RESTORED",
  IMPORT_RECOVERY_BLOCKED:
    "LEDGER_FILE_IMPORT_RECOVERY_BLOCKED",
} as const;

type LedgerFileRepositoryErrorCode =
  (typeof LEDGER_FILE_REPOSITORY_ERROR_CODES)[keyof typeof LEDGER_FILE_REPOSITORY_ERROR_CODES];

/**
 * 这个类是账本文件存取出错时抛的错。
 * 带着上面那张表里的错误代码。
 */
export class LedgerFileRepositoryError extends Error {
  constructor(
    readonly code: LedgerFileRepositoryErrorCode,
    message: string,
    readonly cause?: unknown,
  ) {
    super(message);
    this.name = "LedgerFileRepositoryError";
  }
}

/**
 * 存取账本文件时可以换掉的几样。
 * 包括加密工具、编号生成、当前时间。测试里用。
 */
export type LedgerFileRepositoryDependencies = {
  cryptoProvider?: CryptoProvider;
  generateId?: () => string;
  now?: () => Date;
};

/** 上面那几样，再加上这次打开拿到的文件打开权凭条。 */
export type LedgerFileRepositorySessionDependencies =
  LedgerFileRepositoryDependencies & {
    sessionLease: LedgerFileSessionLease;
  };
