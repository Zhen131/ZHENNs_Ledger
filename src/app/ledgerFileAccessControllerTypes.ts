import { type LedgerFileHandle } from "@/platform/files";
import { type LedgerFileConnectionRecordV1 } from "@/platform/files";
import { type LedgerFileSessionLease } from "@/platform/coordination";
import { type LedgerSession } from "@/platform/persistence";
import {
  LedgerFileRepository,
  type LedgerFileRecoveryCandidate,
} from "@/platform/files";

export const LEDGER_FILE_ACCESS_ERROR_CODES = {
  CANCELLED: "LEDGER_FILE_ACCESS_CANCELLED",
  PICKER_UNAVAILABLE: "LEDGER_FILE_PICKER_UNAVAILABLE",
  INVALID_EXTENSION: "LEDGER_FILE_INVALID_EXTENSION",
  NON_EMPTY_CREATE_TARGET: "LEDGER_FILE_NON_EMPTY_CREATE_TARGET",
  UNSUPPORTED_FILE_VERSION:
    "LEDGER_FILE_ACCESS_UNSUPPORTED_FILE_VERSION",
  UNSUPPORTED_LEDGER_SCHEMA:
    "LEDGER_FILE_ACCESS_UNSUPPORTED_LEDGER_SCHEMA",
  RETIRED_LEDGER_SCHEMA_V4:
    "LEDGER_FILE_ACCESS_RETIRED_LEDGER_SCHEMA_V4",
  INVALID_FILE: "LEDGER_FILE_ACCESS_INVALID_FILE",
  CREATE_FAILED: "LEDGER_FILE_ACCESS_CREATE_FAILED",
  UNLOCK_FAILED: "LEDGER_FILE_ACCESS_UNLOCK_FAILED",
  NO_SELECTION: "LEDGER_FILE_ACCESS_NO_SELECTION",
  FILE_IN_USE: "LEDGER_FILE_ACCESS_FILE_IN_USE",
  COORDINATION_UNSUPPORTED:
    "LEDGER_FILE_ACCESS_COORDINATION_UNSUPPORTED",
  COORDINATION_FAILED: "LEDGER_FILE_ACCESS_COORDINATION_FAILED",
  RECOVERY_NOT_FOUND: "LEDGER_FILE_ACCESS_RECOVERY_NOT_FOUND",
  RECOVERY_FAILED: "LEDGER_FILE_ACCESS_RECOVERY_FAILED",
  EXTERNAL_CHANGE: "LEDGER_FILE_ACCESS_EXTERNAL_CHANGE",
  CONNECTION_INVALID: "LEDGER_FILE_ACCESS_CONNECTION_INVALID",
  CONNECTION_SAVE_FAILED:
    "LEDGER_FILE_ACCESS_CONNECTION_SAVE_FAILED",
  PERMISSION_DENIED: "LEDGER_FILE_ACCESS_PERMISSION_DENIED",
  PERMISSION_REQUIRED: "LEDGER_FILE_ACCESS_PERMISSION_REQUIRED",
  RECONNECT_FAILED: "LEDGER_FILE_ACCESS_RECONNECT_FAILED",
  WRONG_RECONNECT_FILE: "LEDGER_FILE_ACCESS_WRONG_RECONNECT_FILE",
} as const;

export type LedgerFileAccessErrorCode =
  (typeof LEDGER_FILE_ACCESS_ERROR_CODES)[keyof typeof LEDGER_FILE_ACCESS_ERROR_CODES];

export type LedgerFileAccessSessionResult =
  | { status: "unlocked"; ok: true; session: LedgerSession }
  | {
      status: "recovery-required";
      ok: false;
      recoveryId: string;
    }
  | {
      status: "error";
      ok: false;
      code: LedgerFileAccessErrorCode;
    };

export type LedgerFileSelectionResult =
  | { ok: true }
  | { ok: false; code: LedgerFileAccessErrorCode };

export type LedgerFileReconnectResult =
  | { status: "none"; ok: true }
  | { status: "ready"; ok: true }
  | { status: "permission-prompt"; ok: false }
  | {
      status: "error";
      ok: false;
      code: LedgerFileAccessErrorCode;
    };

export interface LedgerFileAccessController {
  inspectRememberedConnection(): Promise<LedgerFileReconnectResult>;
  requestRememberedPermission(): Promise<LedgerFileReconnectResult>;
  reselectRememberedConnection(): Promise<LedgerFileSelectionResult>;
  forgetRememberedConnection(): Promise<void>;
  create(passphrase: string): Promise<LedgerFileAccessSessionResult>;
  selectExisting(): Promise<LedgerFileSelectionResult>;
  unlockSelected(
    passphrase: string,
  ): Promise<LedgerFileAccessSessionResult>;
  confirmRecovery(
    recoveryId: string,
  ): Promise<LedgerFileAccessSessionResult>;
  cancelRecovery(recoveryId: string): Promise<void>;
  cancelPendingSelection(): void;
}

export type PendingSelection = {
  handle: LedgerFileHandle;
  fileId: string;
  connectionRecord: LedgerFileConnectionRecordV1;
};

export type PendingRecovery = {
  recoveryId: string;
  candidate: LedgerFileRecoveryCandidate;
  lease: LedgerFileSessionLease;
  operation: number;
  confirmation: Promise<LedgerFileAccessSessionResult> | null;
  cancelRequested: boolean;
  cancellation: Promise<void> | null;
  connectionRecord: LedgerFileConnectionRecordV1;
};

export type ActiveLedgerFileSession = {
  session: LedgerSession;
  repository: LedgerFileRepository;
  lease: LedgerFileSessionLease;
  releaseAttempt: Promise<void> | null;
};

export type RetainedLeaseCleanup = {
  lease: LedgerFileSessionLease;
  releaseAttempt: Promise<void> | null;
};
