/**
 * 这个文件管查账本时用到的错误代码和结果的样子。
 * 每种记录允许出现的字段名也在这里。
 * 它不管怎么查，那在 ledgerDataValidator.ts 和同名开头的几个文件。
 * 不显然的决定：数字只认一种写法。2026-08-19 定（W14 01B 第 3.5 节）。
 */

import type { LedgerData } from "@/core/models";

/** 查整本账本时可能报的错误代码，名字固定不变。 */
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

/** 一条账本检查错误：错误代码、出错的位置、给人看的说明。 */
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

/**
 * 整本账本的检查结果。
 * 通过就给出账本，不通过就给出全部错误。
 */
export type LedgerDataValidationResult =
  | { ok: true; value: LedgerData }
  | { ok: false; errors: LedgerDataValidationError[] };

/** 账本最外层必须有的七个字段。 */
export const ROOT_KEYS = [
  "schemaVersion",
  "assets",
  "trades",
  "cashEvents",
  "assetTransfers",
  "priceSnapshots",
  "feeRules",
] as const;
/** 一个资产允许出现的字段名。 */
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
/** 一个 Binance 交易对映射必须有的四个字段名。 */
export const BINANCE_MAPPING_KEYS = [
  "provider",
  "symbol",
  "baseAsset",
  "quoteAsset",
] as const;
/** 一笔买卖允许出现的字段名。 */
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
/** 现金记录共有的字段名。 */
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
/** 入金、出金、外部支出允许出现的字段名：共有的再加金额。 */
export const CASH_FLOW_KEYS = [...CASH_BASE_KEYS, "amount"] as const;
/** 余额校准允许出现的字段名：共有的再加三个余额数。 */
export const CASH_ADJUSTMENT_KEYS = [
  ...CASH_BASE_KEYS,
  "balanceBefore",
  "targetBalance",
  "adjustmentAmount",
] as const;
/** 一笔资产转移允许出现的字段名。 */
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
/** 一条记下来的价格允许出现的字段名。 */
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
/** 行情价格来历必须有的四个字段名。 */
export const BINANCE_PROVENANCE_KEYS = [
  "provider",
  "symbol",
  "sourceQuoteCurrency",
  "fetchedAt",
] as const;
/** 手续费规则共有的字段名。 */
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
/** 固定金额手续费规则允许出现的字段名：共有的再加金额。 */
export const FIXED_FEE_RULE_KEYS = [...FEE_RULE_BASE_KEYS, "amount"] as const;
/** 按比例手续费规则允许出现的字段名：共有的再加比例。 */
export const PERCENTAGE_FEE_RULE_KEYS = [...FEE_RULE_BASE_KEYS, "rate"] as const;
/**
 * 数字文字唯一认的写法。
 * 不许有加号、指数、多余的前导零。
 * 为什么只认一种：同一个数只有一种写法。2026-08-19 定（W14 01B 第 3.5 节）。
 */
export const DECIMAL_PATTERN = /^-?(?:0|[1-9]\d*)(?:\.\d+)?$/;
/**
 * 资产代码的写法：大写字母和数字，1 到 32 个字。
 * 为什么是 32：2026-08-19 定（W14 01B 第 3.5 节、第 4.1 节）。
 */
export const ASSET_SYMBOL_PATTERN = /^[A-Z0-9]{1,32}$/;
