import { LedgerFileAdapterError } from "@/platform/files";
import { LedgerFileConnectionRecordError } from "@/platform/files";
import {
  LEDGER_FILE_REPOSITORY_ERROR_CODES,
  LedgerFileRepositoryError,
} from "@/platform/files";
import {
  LEDGER_FILE_ACCESS_ERROR_CODES,
  type LedgerFileAccessErrorCode,
  type LedgerFileAccessSessionResult,
  type LedgerFileReconnectResult,
} from "./ledgerFileAccessControllerTypes";

export class LedgerFileConnectionCommitError extends Error {
  constructor(readonly cause: unknown) {
    super("Could not save the verified ledger file connection");
    this.name = "LedgerFileConnectionCommitError";
  }
}
export function staleOperationResult(): {
  status: "error";
  ok: false;
  code: typeof LEDGER_FILE_ACCESS_ERROR_CODES.CANCELLED;
} {
  return {
    status: "error",
    ok: false,
    code: LEDGER_FILE_ACCESS_ERROR_CODES.CANCELLED,
  };
}

export function staleSelectionResult(): {
  ok: false;
  code: typeof LEDGER_FILE_ACCESS_ERROR_CODES.CANCELLED;
} {
  return {
    ok: false,
    code: LEDGER_FILE_ACCESS_ERROR_CODES.CANCELLED,
  };
}

export function reconnectError(
  code: LedgerFileAccessErrorCode,
): Extract<LedgerFileReconnectResult, { status: "error" }> {
  return {
    status: "error",
    ok: false,
    code,
  };
}

export function coordinationFailureResult(
  status: "in-use" | "unsupported" | "coordination-failed",
): LedgerFileAccessSessionResult {
  if (status === "in-use") {
    return {
      status: "error",
      ok: false,
      code: LEDGER_FILE_ACCESS_ERROR_CODES.FILE_IN_USE,
    };
  }
  return {
    status: "error",
    ok: false,
    code:
      status === "unsupported"
        ? LEDGER_FILE_ACCESS_ERROR_CODES.COORDINATION_UNSUPPORTED
        : LEDGER_FILE_ACCESS_ERROR_CODES.COORDINATION_FAILED,
  };
}

export function ownedFileSessionResult(): LedgerFileAccessSessionResult {
  return {
    status: "error",
    ok: false,
    code: LEDGER_FILE_ACCESS_ERROR_CODES.FILE_IN_USE,
  };
}

export function mapCreateError(error: unknown): LedgerFileAccessErrorCode {
  if (error instanceof LedgerFileConnectionCommitError) {
    return LEDGER_FILE_ACCESS_ERROR_CODES.CONNECTION_SAVE_FAILED;
  }
  if (error instanceof LedgerFileAdapterError) {
    if (error.stage === "extension") {
      return LEDGER_FILE_ACCESS_ERROR_CODES.INVALID_EXTENSION;
    }
    if (error.stage === "target") {
      return LEDGER_FILE_ACCESS_ERROR_CODES.NON_EMPTY_CREATE_TARGET;
    }
    if (
      error.stage === "picker" &&
      error.message.includes("unavailable")
    ) {
      return LEDGER_FILE_ACCESS_ERROR_CODES.PICKER_UNAVAILABLE;
    }
  }

  return LEDGER_FILE_ACCESS_ERROR_CODES.CREATE_FAILED;
}

export function mapSelectionError(error: unknown): LedgerFileAccessErrorCode {
  if (error instanceof LedgerFileAdapterError) {
    if (error.stage === "extension") {
      return LEDGER_FILE_ACCESS_ERROR_CODES.INVALID_EXTENSION;
    }
    if (
      error.stage === "picker" &&
      error.message.includes("unavailable")
    ) {
      return LEDGER_FILE_ACCESS_ERROR_CODES.PICKER_UNAVAILABLE;
    }
  }
  if (
    error instanceof LedgerFileRepositoryError &&
    error.code === LEDGER_FILE_REPOSITORY_ERROR_CODES.INVALID_FILE
  ) {
    if (hasLedgerFileContractError(
      error.cause,
      "LEDGER_FILE_RETIRED_LEDGER_SCHEMA_V4",
    )) {
      return LEDGER_FILE_ACCESS_ERROR_CODES.RETIRED_LEDGER_SCHEMA_V4;
    }
    if (hasLedgerFileContractError(
      error.cause,
      "LEDGER_FILE_UNSUPPORTED_VERSION",
    )) {
      return LEDGER_FILE_ACCESS_ERROR_CODES.UNSUPPORTED_FILE_VERSION;
    }
    if (hasLedgerFileContractError(
      error.cause,
      "LEDGER_FILE_UNSUPPORTED_LEDGER_SCHEMA",
    )) {
      return LEDGER_FILE_ACCESS_ERROR_CODES.UNSUPPORTED_LEDGER_SCHEMA;
    }
    return LEDGER_FILE_ACCESS_ERROR_CODES.INVALID_FILE;
  }

  return LEDGER_FILE_ACCESS_ERROR_CODES.INVALID_FILE;
}

export function hasLedgerFileContractError(
  cause: unknown,
  code: string,
): boolean {
  return (
    Array.isArray(cause) &&
    cause.some(
      (item) =>
        typeof item === "object" &&
        item !== null &&
        "code" in item &&
        item.code === code,
    )
  );
}

export function mapUnlockError(error: unknown): LedgerFileAccessErrorCode {
  if (error instanceof LedgerFileConnectionCommitError) {
    return LEDGER_FILE_ACCESS_ERROR_CODES.CONNECTION_SAVE_FAILED;
  }
  if (
    error instanceof LedgerFileRepositoryError &&
    error.code === LEDGER_FILE_REPOSITORY_ERROR_CODES.EXTERNAL_CHANGE
  ) {
    return LEDGER_FILE_ACCESS_ERROR_CODES.EXTERNAL_CHANGE;
  }
  return LEDGER_FILE_ACCESS_ERROR_CODES.UNLOCK_FAILED;
}

export function mapReconnectError(error: unknown): LedgerFileAccessErrorCode {
  if (error instanceof LedgerFileConnectionRecordError) {
    return LEDGER_FILE_ACCESS_ERROR_CODES.CONNECTION_INVALID;
  }
  if (
    error instanceof LedgerFileAdapterError &&
    (error.stage === "permission-query" ||
      error.stage === "permission-request")
  ) {
    return LEDGER_FILE_ACCESS_ERROR_CODES.RECONNECT_FAILED;
  }
  return LEDGER_FILE_ACCESS_ERROR_CODES.RECONNECT_FAILED;
}

export async function bestEffortWait(operation: Promise<void>): Promise<void> {
  try {
    await operation;
  } catch {
    // The retained owner keeps the controller fail-closed for an explicit retry.
  }
}

export function invokePromise(operation: () => Promise<void>): Promise<void> {
  try {
    return operation();
  } catch (error) {
    return Promise.reject(error);
  }
}

export function defaultCreateRecoveryId(): string {
  return globalThis.crypto.randomUUID();
}
