/**
 * 这个文件放打开账本文件那一套的几个小帮手。
 * 它们把错误翻成错误码，或给出几个固定结果。
 * 打开、新建、解锁的步骤本身在同目录 `ledgerFileAccessController.ts`。
 * 不显然的决定：释放独占凭证失败时不报错。
 * 凭证先留着，等用户重试时再放。
 */
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

/** 文件验过了、但「记住这个文件」那一步存失败时抛的错。 */
export class LedgerFileConnectionCommitError extends Error {
  constructor(readonly cause: unknown) {
    super("Could not save the verified ledger file connection");
    this.name = "LedgerFileConnectionCommitError";
  }
}
/** 这个函数给一个「这次操作已经过时、算取消」的结果。 */
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

/** 这个函数给一个「这次选文件已经过时、算取消」的结果。 */
export function staleSelectionResult(): {
  ok: false;
  code: typeof LEDGER_FILE_ACCESS_ERROR_CODES.CANCELLED;
} {
  return {
    ok: false,
    code: LEDGER_FILE_ACCESS_ERROR_CODES.CANCELLED,
  };
}

/** 这个函数把一个错误码包成重连失败的结果。 */
export function reconnectError(
  code: LedgerFileAccessErrorCode,
): Extract<LedgerFileReconnectResult, { status: "error" }> {
  return {
    status: "error",
    ok: false,
    code,
  };
}

/**
 * 这个函数把「抢不到独占」的原因翻成错误码。
 * 举例：文件在另一个标签页里开着 → 答 `FILE_IN_USE`。
 * 浏览器不支持协调 → 答 `COORDINATION_UNSUPPORTED`；别的是 `COORDINATION_FAILED`。
 */
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

/** 这个函数给「这里已经开着一本账本文件」的结果，错误码 `FILE_IN_USE`。 */
export function ownedFileSessionResult(): LedgerFileAccessSessionResult {
  return {
    status: "error",
    ok: false,
    code: LEDGER_FILE_ACCESS_ERROR_CODES.FILE_IN_USE,
  };
}

/**
 * 这个函数把新建账本文件时的错误翻成错误码。
 * 举例：选的文件不是 .lftl → 答 `INVALID_EXTENSION`；目标文件不是空的 → 答 `NON_EMPTY_CREATE_TARGET`。
 * 认不出的错一律答 `CREATE_FAILED`。
 */
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

/**
 * 这个函数把选已有文件时的错误翻成错误码。
 * 举例：文件里的账本结构版本是 4 → 答 `RETIRED_LEDGER_SCHEMA_V4`。
 * 文件版本或结构版本不认识，答对应的「不支持」错误码。
 * 认不出的错一律答 `INVALID_FILE`。
 */
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

function hasLedgerFileContractError(
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

/**
 * 这个函数把解锁时的错误翻成错误码。
 * 文件被别的程序改过答 `EXTERNAL_CHANGE`；别的一律答 `UNLOCK_FAILED`。
 */
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

/**
 * 这个函数把重连上次文件时的错误翻成错误码。
 * 记住的连接信息坏了答 `CONNECTION_INVALID`；别的都答 `RECONNECT_FAILED`。
 */
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

/**
 * 这个函数等一件事做完，失败了也不往外抛。
 * 给释放独占凭证这类「尽量做」的收尾用。
 */
export async function bestEffortWait(operation: Promise<void>): Promise<void> {
  try {
    await operation;
  } catch {
    // 为什么吞掉错误：凭证还被留着，出错就停下，不乱动文件。
    // 等用户明确重试时再放。2026-07-31 提交 40c7fa4 写下这个理由。
  }
}

/** 这个函数调一个返回 Promise 的动作，同步抛的错也变成失败的 Promise。 */
export function invokePromise(operation: () => Promise<void>): Promise<void> {
  try {
    return operation();
  } catch (error) {
    return Promise.reject(error);
  }
}

/** 这个函数给一次恢复生成一个随机编号。 */
export function defaultCreateRecoveryId(): string {
  return globalThis.crypto.randomUUID();
}
