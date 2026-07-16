import type { LedgerData } from "../models";

export const LEDGER_REPOSITORY_ERROR_CODES = {
  READ_FAILED: "LEDGER_REPOSITORY_READ_FAILED",
  WRITE_FAILED: "LEDGER_REPOSITORY_WRITE_FAILED",
  CLEAR_FAILED: "LEDGER_REPOSITORY_CLEAR_FAILED",
  INVALID_LEDGER_DATA: "LEDGER_REPOSITORY_INVALID_LEDGER_DATA",
  INVALID_STORED_DATA: "LEDGER_REPOSITORY_INVALID_STORED_DATA",
} as const;

export type LedgerRepositoryErrorCode =
  (typeof LEDGER_REPOSITORY_ERROR_CODES)[keyof typeof LEDGER_REPOSITORY_ERROR_CODES];

export class LedgerRepositoryError extends Error {
  readonly code: LedgerRepositoryErrorCode;
  readonly cause?: unknown;

  constructor(
    code: LedgerRepositoryErrorCode,
    message: string,
    cause?: unknown,
  ) {
    super(message);
    this.name = "LedgerRepositoryError";
    this.code = code;
    this.cause = cause;
  }
}

/**
 * 上层唯一的整账持久化入口。
 *
 * load 的 null 明确表示“没有保存数据”；它与已保存的空账本不同。
 */
export interface LedgerRepository {
  load(): Promise<LedgerData | null>;
  save(ledgerData: LedgerData): Promise<void>;
  clear(): Promise<void>;
}
