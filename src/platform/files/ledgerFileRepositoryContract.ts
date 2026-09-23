import type { LedgerFileSessionLease } from "./ledgerFileSessionLease";
import type { CryptoProvider } from "@/platform/encryption";

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

export type LedgerFileRepositoryErrorCode =
  (typeof LEDGER_FILE_REPOSITORY_ERROR_CODES)[keyof typeof LEDGER_FILE_REPOSITORY_ERROR_CODES];

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

export type LedgerFileRepositoryDependencies = {
  cryptoProvider?: CryptoProvider;
  generateId?: () => string;
  now?: () => Date;
};

export type LedgerFileRepositorySessionDependencies =
  LedgerFileRepositoryDependencies & {
    sessionLease: LedgerFileSessionLease;
  };
