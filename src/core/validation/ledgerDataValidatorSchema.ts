import type { LedgerData } from "@/core/models";

export const LEDGER_DATA_VALIDATION_ERROR_CODES = {
  INVALID_ROOT: "LEDGER_DATA_INVALID_ROOT",
  UNSUPPORTED_SCHEMA_VERSION: "LEDGER_DATA_UNSUPPORTED_SCHEMA_VERSION",
  INVALID_COLLECTION: "LEDGER_DATA_INVALID_COLLECTION",
  INVALID_ENTITY: "LEDGER_DATA_INVALID_ENTITY",
  DUPLICATE_IDENTIFIER: "LEDGER_DATA_DUPLICATE_IDENTIFIER",
  DUPLICATE_ASSET_SYMBOL: "LEDGER_DATA_DUPLICATE_ASSET_SYMBOL",
  INVALID_REFERENCE: "LEDGER_DATA_INVALID_REFERENCE",
  INVALID_TRADE_TIMELINE: "LEDGER_DATA_INVALID_TRADE_TIMELINE",
} as const;

export type LedgerDataValidationError = {
  code:
    | "LEDGER_DATA_INVALID_ROOT"
    | "LEDGER_DATA_UNSUPPORTED_SCHEMA_VERSION"
    | "LEDGER_DATA_INVALID_COLLECTION"
    | "LEDGER_DATA_INVALID_ENTITY"
    | "LEDGER_DATA_DUPLICATE_IDENTIFIER"
    | "LEDGER_DATA_DUPLICATE_ASSET_SYMBOL"
    | "LEDGER_DATA_INVALID_REFERENCE"
    | "LEDGER_DATA_INVALID_TRADE_TIMELINE";
  path: string;
  message: string;
};

export type LedgerDataValidationResult =
  | { ok: true; value: LedgerData }
  | { ok: false; errors: LedgerDataValidationError[] };

export const ROOT_KEYS = [
  "schemaVersion",
  "assets",
  "trades",
  "cashEvents",
  "assetTransfers",
  "priceSnapshots",
  "feeRules",
] as const;
export const ASSET_KEYS = [
  "id",
  "symbol",
  "name",
  "quoteCurrency",
  "decimals",
  "binanceMapping",
  "createdAt",
  "updatedAt",
] as const;
export const BINANCE_MAPPING_KEYS = [
  "provider",
  "symbol",
  "baseAsset",
  "quoteAsset",
] as const;
export const TRADE_KEYS = [
  "id",
  "occurredAt",
  "occurredTimeZone",
  "timePrecision",
  "type",
  "assetSymbol",
  "quantity",
  "quantitySortKey",
  "price",
  "totalValue",
  "totalValueSortKey",
  "currency",
  "fee",
  "feeCurrency",
  "platform",
  "feeRuleId",
  "note",
  "rawText",
  "createdAt",
  "updatedAt",
] as const;
export const CASH_BASE_KEYS = [
  "id",
  "occurredAt",
  "occurredTimeZone",
  "timePrecision",
  "type",
  "currency",
  "note",
  "createdAt",
  "updatedAt",
] as const;
export const CASH_FLOW_KEYS = [...CASH_BASE_KEYS, "amount"] as const;
export const CASH_ADJUSTMENT_KEYS = [
  ...CASH_BASE_KEYS,
  "balanceBefore",
  "targetBalance",
  "adjustmentAmount",
] as const;
export const ASSET_TRANSFER_KEYS = [
  "id",
  "occurredAt",
  "occurredTimeZone",
  "timePrecision",
  "assetSymbol",
  "quantity",
  "category",
  "reason",
  "unitPrice",
  "networkFee",
  "fromLocation",
  "toLocation",
  "note",
  "createdAt",
  "updatedAt",
] as const;
export const PRICE_KEYS = [
  "id",
  "assetSymbol",
  "price",
  "currency",
  "recordedAt",
  "occurredTimeZone",
  "source",
  "binanceProvenance",
  "note",
  "createdAt",
  "updatedAt",
] as const;
export const BINANCE_PROVENANCE_KEYS = [
  "provider",
  "symbol",
  "sourceQuoteCurrency",
  "fetchedAt",
] as const;
export const FEE_RULE_BASE_KEYS = [
  "id",
  "name",
  "platform",
  "assetSymbol",
  "status",
  "type",
  "currency",
  "createdAt",
  "updatedAt",
  "deactivatedAt",
  "replacesFeeRuleId",
] as const;
export const FIXED_FEE_RULE_KEYS = [...FEE_RULE_BASE_KEYS, "amount"] as const;
export const PERCENTAGE_FEE_RULE_KEYS = [...FEE_RULE_BASE_KEYS, "rate"] as const;
export const DECIMAL_PATTERN = /^-?(?:0|[1-9]\d*)(?:\.\d+)?$/;
export const ASSET_SYMBOL_PATTERN = /^[A-Z0-9]{1,32}$/;
