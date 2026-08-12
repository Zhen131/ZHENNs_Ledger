export const LEDGER_ACCESS_ERROR_CODES = {
  READ_FAILED: "LEDGER_ACCESS_READ_FAILED",
  UNSUPPORTED_FORMAT: "LEDGER_ACCESS_UNSUPPORTED_FORMAT",
  INVALID_ENVELOPE: "LEDGER_ACCESS_INVALID_ENVELOPE",
} as const;

export type LedgerAccessErrorCode =
  (typeof LEDGER_ACCESS_ERROR_CODES)[keyof typeof LEDGER_ACCESS_ERROR_CODES];

export type LedgerAccessInspection =
  | { status: "setup-required" }
  | { status: "unlock-required" }
  | { status: "error"; code: LedgerAccessErrorCode };

/**
 * The production IndexedDB boundary is intentionally presence-only.
 * Legacy whole-ledger data can be detected, but it cannot be unlocked,
 * migrated, written, or deleted through the V2 application composition.
 */
export interface LedgerAccessController {
  inspect(): Promise<LedgerAccessInspection>;
}
