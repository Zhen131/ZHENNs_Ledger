/**
 * 这个文件放打开账本文件那一套用到的错误码和类型。
 * 真正打开、新建、解锁的步骤在同目录 `ledgerFileAccessController.ts`。
 * 没有特别的决定。
 */
import { type LedgerFileHandle } from "@/platform/files";
import { type LedgerFileConnectionRecordV1 } from "@/platform/files";
import { type LedgerFileSessionLease } from "@/platform/coordination";
import { type LedgerSession } from "@/platform/persistence";
import {
  LedgerFileRepository,
  type LedgerFileRecoveryCandidate,
} from "@/platform/files";

/** 打开账本文件时会碰到的全部错误码。
 * 比如扩展名不对，文件被别处占着，密码不对。 */
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

/** 上面那些错误码里的任意一个。 */
export type LedgerFileAccessErrorCode =
  (typeof LEDGER_FILE_ACCESS_ERROR_CODES)[keyof typeof LEDGER_FILE_ACCESS_ERROR_CODES];

/**
 * 新建或解锁一个账本文件的结果。
 * 成功就带上会话；文件上次没存完要先确认恢复；或者带错误码。
 */
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

/** 选一个已有账本文件的结果：选好了，或者带错误码。 */
export type LedgerFileSelectionResult =
  | { ok: true }
  | { ok: false; code: LedgerFileAccessErrorCode };

/**
 * 重连上次那个账本文件的结果。
 * 四种：没记着上次的文件；已经能用；要浏览器再问权限；出错。
 */
export type LedgerFileReconnectResult =
  | { status: "none"; ok: true }
  | { status: "ready"; ok: true }
  | { status: "permission-prompt"; ok: false }
  | {
      status: "error";
      ok: false;
      code: LedgerFileAccessErrorCode;
    };

/**
 * 进账本前那道检查用来开文件的一组动作。
 * 重连上次的文件，新建，选已有文件，解锁，确认或取消恢复。
 */
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

/** 选好还没解锁的文件：句柄，文件编号，要记住的连接信息。 */
export type PendingSelection = {
  handle: LedgerFileHandle;
  fileId: string;
  connectionRecord: LedgerFileConnectionRecordV1;
};

/** 等用户确认的一次恢复：恢复哪份，独占凭证，进行到哪。 */
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

/** 当前打开的账本文件：会话，仓库，独占凭证，正在进行的释放。 */
export type ActiveLedgerFileSession = {
  session: LedgerSession;
  repository: LedgerFileRepository;
  lease: LedgerFileSessionLease;
  releaseAttempt: Promise<void> | null;
};

/** 释放失败、先留着等以后再放的一张独占凭证。 */
export type RetainedLeaseCleanup = {
  lease: LedgerFileSessionLease;
  releaseAttempt: Promise<void> | null;
};
