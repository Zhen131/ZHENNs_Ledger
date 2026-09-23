import { LedgerFileAdapterError } from "./ledgerFileHandleAdapterContract";
import {
  LEDGER_FILE_REPOSITORY_ERROR_CODES,
  LedgerFileRepositoryError,
} from "./ledgerFileRepositoryContract";

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

export function clearAuthorizationError(): LedgerFileRepositoryError {
  return new LedgerFileRepositoryError(
    LEDGER_FILE_REPOSITORY_ERROR_CODES.CLEAR_AUTHORIZATION_FAILED,
    "Ready ledger clear authorization is invalid, stale, or already used",
  );
}

export function importAuthorizationError(
  message =
    "Ready ledger import authorization is invalid, stale, cancelled, or already used",
): LedgerFileRepositoryError {
  return new LedgerFileRepositoryError(
    LEDGER_FILE_REPOSITORY_ERROR_CODES.IMPORT_AUTHORIZATION_FAILED,
    message,
  );
}

export function importRecoveryBlockedError(
  cause: unknown,
): LedgerFileRepositoryError {
  return new LedgerFileRepositoryError(
    LEDGER_FILE_REPOSITORY_ERROR_CODES.IMPORT_RECOVERY_BLOCKED,
    "Ledger-file import could not safely restore and verify the exact pre-import C",
    cause,
  );
}

export function assertImportActive(signal: AbortSignal): void {
  if (signal.aborted) {
    throw importAuthorizationError(
      "Ready ledger import was cancelled by its bound lifecycle",
    );
  }
}

export function defaultGenerateId(): string {
  return globalThis.crypto.randomUUID();
}
