import { calculatePositions } from "@/core/calculations";
import type {
  Asset,
  BinanceMarketMapping,
  BinancePriceProvenance,
  CashEvent,
  FeeRule,
  LedgerData,
  PriceSnapshot,
  Trade,
} from "@/core/models";
import { add, isEqual, isNegative, isPositive, isZero } from "@/core/shared";
import { isValidISODateOrDateTime } from "./isoDateValidator";
import { validatePriceSnapshotDraft } from "./priceSnapshotValidator";
import { validateTradeDraft } from "./tradeValidator";

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

export type IndexedValidatedLedgerTrade = Readonly<{
  originalIndex: number;
  trade: Readonly<Trade>;
}>;

const ROOT_KEYS = [
  "schemaVersion",
  "assets",
  "trades",
  "cashEvents",
  "priceSnapshots",
  "feeRules",
] as const;
const ASSET_KEYS = [
  "id",
  "symbol",
  "name",
  "quoteCurrency",
  "decimals",
  "binanceMapping",
  "createdAt",
  "updatedAt",
] as const;
const BINANCE_MAPPING_KEYS = [
  "provider",
  "symbol",
  "baseAsset",
  "quoteAsset",
] as const;
const TRADE_KEYS = [
  "id",
  "occurredAt",
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
const CASH_BASE_KEYS = [
  "id",
  "occurredAt",
  "timePrecision",
  "type",
  "currency",
  "note",
  "createdAt",
  "updatedAt",
] as const;
const CASH_FLOW_KEYS = [...CASH_BASE_KEYS, "amount"] as const;
const CASH_ADJUSTMENT_KEYS = [
  ...CASH_BASE_KEYS,
  "balanceBefore",
  "targetBalance",
  "adjustmentAmount",
] as const;
const PRICE_KEYS = [
  "id",
  "assetSymbol",
  "price",
  "currency",
  "recordedAt",
  "source",
  "binanceProvenance",
  "note",
  "createdAt",
  "updatedAt",
] as const;
const BINANCE_PROVENANCE_KEYS = [
  "provider",
  "symbol",
  "sourceQuoteCurrency",
  "fetchedAt",
] as const;
const FEE_RULE_BASE_KEYS = [
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
const FIXED_FEE_RULE_KEYS = [...FEE_RULE_BASE_KEYS, "amount"] as const;
const PERCENTAGE_FEE_RULE_KEYS = [...FEE_RULE_BASE_KEYS, "rate"] as const;
const DECIMAL_PATTERN = /^-?(?:0|[1-9]\d*)(?:\.\d+)?$/;
const ASSET_SYMBOL_PATTERN = /^[A-Z0-9]{1,32}$/;

/**
 * Persistence exports accept the live application object but serialize only
 * the six canonical V3 fact fields. Import validation remains exact and must
 * call validateLedgerData directly.
 */
export function selectLedgerDataFacts(input: unknown): unknown {
  if (!isRecord(input)) {
    return input;
  }

  return {
    schemaVersion: input.schemaVersion,
    assets: input.assets,
    trades: input.trades,
    cashEvents: input.cashEvents,
    priceSnapshots: input.priceSnapshots,
    feeRules: input.feeRules,
  };
}

export function validateLedgerData(input: unknown): LedgerDataValidationResult {
  if (!isRecord(input)) {
    return {
      ok: false,
      errors: [
        createError(
          LEDGER_DATA_VALIDATION_ERROR_CODES.INVALID_ROOT,
          "ledgerData",
          "LedgerData must be an object",
        ),
      ],
    };
  }

  const errors: LedgerDataValidationError[] = [];
  checkExactKeys(input, ROOT_KEYS, "ledgerData", errors);
  if (input.schemaVersion !== 3) {
    errors.push(
      createError(
        LEDGER_DATA_VALIDATION_ERROR_CODES.UNSUPPORTED_SCHEMA_VERSION,
        "schemaVersion",
        `Unsupported schema version: ${String(input.schemaVersion)}`,
      ),
    );
  }

  const rawAssets = readCollection(input, "assets", errors);
  const rawTrades = readCollection(input, "trades", errors);
  const rawCashEvents = readCollection(input, "cashEvents", errors);
  const rawPriceSnapshots = readCollection(input, "priceSnapshots", errors);
  const rawFeeRules = readCollection(input, "feeRules", errors);
  if (
    rawAssets === undefined ||
    rawTrades === undefined ||
    rawCashEvents === undefined ||
    rawPriceSnapshots === undefined ||
    rawFeeRules === undefined
  ) {
    return { ok: false, errors };
  }

  const assets = rawAssets
    .map((value, index) => readAsset(value, index, errors))
    .filter((value): value is Asset => value !== undefined);
  const feeRules = rawFeeRules
    .map((value, index) => readFeeRule(value, index, assets, errors))
    .filter((value): value is FeeRule => value !== undefined);
  const trades = rawTrades
    .map((value, index) => readTrade(value, index, assets, errors))
    .filter((value): value is Trade => value !== undefined);
  const cashEvents = rawCashEvents
    .map((value, index) => readCashEvent(value, index, errors))
    .filter((value): value is CashEvent => value !== undefined);
  const priceSnapshots = rawPriceSnapshots
    .map((value, index) => readPriceSnapshot(value, index, assets, errors))
    .filter((value): value is PriceSnapshot => value !== undefined);

  validateGlobalIdentifiers(
    { assets, trades, cashEvents, priceSnapshots, feeRules },
    errors,
  );
  validateUniqueAssetSymbols(assets, errors);
  validateReferences(trades, priceSnapshots, feeRules, assets, errors);

  if (
    errors.length === 0 &&
    assets.length === rawAssets.length &&
    trades.length === rawTrades.length &&
    cashEvents.length === rawCashEvents.length &&
    priceSnapshots.length === rawPriceSnapshots.length &&
    feeRules.length === rawFeeRules.length
  ) {
    try {
      calculatePositions(trades, priceSnapshots);
    } catch (error) {
      errors.push(
        createError(
          LEDGER_DATA_VALIDATION_ERROR_CODES.INVALID_TRADE_TIMELINE,
          "trades",
          error instanceof Error
            ? error.message
            : "Trade timeline cannot be calculated",
        ),
      );
    }
  }

  if (errors.length > 0) {
    return { ok: false, errors };
  }

  return {
    ok: true,
    value: {
      schemaVersion: 3,
      assets,
      trades,
      cashEvents,
      priceSnapshots,
      feeRules,
    },
  };
}

export function collectValidLedgerTradeProjections(
  input: unknown,
): readonly IndexedValidatedLedgerTrade[] {
  if (!isRecord(input)) return [];
  const errors: LedgerDataValidationError[] = [];
  const rawAssets = readCollection(input, "assets", errors);
  const rawTrades = readCollection(input, "trades", errors);
  if (rawAssets === undefined || rawTrades === undefined) return [];
  const assets = rawAssets
    .map((value, index) => readAsset(value, index, errors))
    .filter((value): value is Asset => value !== undefined);
  const projections: IndexedValidatedLedgerTrade[] = [];
  rawTrades.forEach((value, originalIndex) => {
    const trade = readTrade(value, originalIndex, assets, errors);
    if (trade !== undefined) projections.push({ originalIndex, trade });
  });
  return projections;
}

function readCollection(
  input: Record<string, unknown>,
  field: "assets" | "trades" | "cashEvents" | "priceSnapshots" | "feeRules",
  errors: LedgerDataValidationError[],
): unknown[] | undefined {
  const value = input[field];
  if (Array.isArray(value)) return value;
  errors.push(
    createError(
      LEDGER_DATA_VALIDATION_ERROR_CODES.INVALID_COLLECTION,
      field,
      `${field} must be an array`,
    ),
  );
  return undefined;
}

function readAsset(
  value: unknown,
  index: number,
  errors: LedgerDataValidationError[],
): Asset | undefined {
  const path = `assets[${index}]`;
  const record = readEntityRecord(value, path, errors);
  if (!record) return undefined;
  const errorCount = errors.length;
  checkAllowedKeys(record, ASSET_KEYS, path, errors);
  const id = readTechnicalId(record.id, `${path}.id`, errors);
  const symbol = readAssetSymbol(record.symbol, `${path}.symbol`, errors);
  const name = readRequiredString(record.name, `${path}.name`, errors);
  const quoteCurrency = readUsdt(
    record.quoteCurrency,
    `${path}.quoteCurrency`,
    errors,
  );
  const decimals = readOptionalDecimals(
    record.decimals,
    `${path}.decimals`,
    errors,
  );
  const binanceMapping = readBinanceMapping(
    record.binanceMapping,
    symbol,
    `${path}.binanceMapping`,
    errors,
  );
  const createdAt = readTechnicalTimestamp(
    record.createdAt,
    `${path}.createdAt`,
    errors,
  );
  const updatedAt = readTechnicalTimestamp(
    record.updatedAt,
    `${path}.updatedAt`,
    errors,
  );
  validateTimestampOrder(createdAt, updatedAt, `${path}.updatedAt`, errors);
  if (
    errors.length !== errorCount ||
    id === undefined ||
    symbol === undefined ||
    name === undefined ||
    quoteCurrency === undefined ||
    binanceMapping === undefined ||
    createdAt === undefined ||
    updatedAt === undefined
  ) {
    return undefined;
  }
  return {
    id,
    symbol,
    name,
    quoteCurrency,
    ...(decimals === undefined ? {} : { decimals }),
    binanceMapping,
    createdAt,
    updatedAt,
  };
}

function readBinanceMapping(
  value: unknown,
  assetSymbol: string | undefined,
  path: string,
  errors: LedgerDataValidationError[],
): BinanceMarketMapping | null | undefined {
  if (value === null) return null;
  if (!isRecord(value)) {
    errors.push(
      createError(
        LEDGER_DATA_VALIDATION_ERROR_CODES.INVALID_ENTITY,
        path,
        `${path} must be null or an explicit Binance mapping`,
      ),
    );
    return undefined;
  }
  const errorCount = errors.length;
  checkExactKeys(value, BINANCE_MAPPING_KEYS, path, errors);
  const symbol = readBoundedString(value.symbol, `${path}.symbol`, 64, errors);
  const baseAsset = readAssetSymbol(
    value.baseAsset,
    `${path}.baseAsset`,
    errors,
  );
  if (value.provider !== "binance") {
    errors.push(
      createError(
        LEDGER_DATA_VALIDATION_ERROR_CODES.INVALID_ENTITY,
        `${path}.provider`,
        "Binance mapping provider must be binance",
      ),
    );
  }
  if (value.quoteAsset !== "USDT") {
    errors.push(
      createError(
        LEDGER_DATA_VALIDATION_ERROR_CODES.INVALID_ENTITY,
        `${path}.quoteAsset`,
        "Binance mapping quote asset must be USDT",
      ),
    );
  }
  if (
    baseAsset !== undefined &&
    assetSymbol !== undefined &&
    baseAsset !== assetSymbol
  ) {
    errors.push(
      createError(
        LEDGER_DATA_VALIDATION_ERROR_CODES.INVALID_ENTITY,
        `${path}.baseAsset`,
        "Binance mapping base asset must match the ledger asset symbol",
      ),
    );
  }
  if (
    errors.length !== errorCount ||
    symbol === undefined ||
    baseAsset === undefined ||
    value.provider !== "binance" ||
    value.quoteAsset !== "USDT" ||
    baseAsset !== assetSymbol
  ) {
    return undefined;
  }
  return { provider: "binance", symbol, baseAsset, quoteAsset: "USDT" };
}

function readTrade(
  value: unknown,
  index: number,
  assets: readonly Asset[],
  errors: LedgerDataValidationError[],
): Trade | undefined {
  const path = `trades[${index}]`;
  const record = readEntityRecord(value, path, errors);
  if (!record) return undefined;
  const errorCount = errors.length;
  checkAllowedKeys(record, TRADE_KEYS, path, errors);
  const id = readTechnicalId(record.id, `${path}.id`, errors);
  const feeCurrency = readBoundedString(
    record.feeCurrency,
    `${path}.feeCurrency`,
    32,
    errors,
  );
  const occurredAt = readFactTimestamp(
    record.occurredAt,
    `${path}.occurredAt`,
    errors,
  );
  const createdAt = readTechnicalTimestamp(
    record.createdAt,
    `${path}.createdAt`,
    errors,
  );
  const updatedAt = readTechnicalTimestamp(
    record.updatedAt,
    `${path}.updatedAt`,
    errors,
  );
  validateTimestampOrder(createdAt, updatedAt, `${path}.updatedAt`, errors);
  const quantity = readCanonicalDecimal(
    record.quantity,
    `${path}.quantity`,
    errors,
    "positive",
  );
  const price = readCanonicalDecimal(
    record.price,
    `${path}.price`,
    errors,
    "positive",
  );
  const totalValue = readCanonicalDecimal(
    record.totalValue,
    `${path}.totalValue`,
    errors,
    "positive",
  );
  const fee = readCanonicalDecimal(
    record.fee,
    `${path}.fee`,
    errors,
    "non-negative",
  );
  const quantitySortKey = readOptionalCanonicalDecimal(
    record.quantitySortKey,
    `${path}.quantitySortKey`,
    errors,
  );
  const totalValueSortKey = readOptionalCanonicalDecimal(
    record.totalValueSortKey,
    `${path}.totalValueSortKey`,
    errors,
  );
  const validationResult = validateTradeDraft(record, {
    assets,
    priorTrades: [],
    skipHoldingsTimeline: true,
    requiredCurrency: "USDT",
  });
  if (!validationResult.ok) {
    for (const error of validationResult.errors) {
      errors.push(
        createError(
          LEDGER_DATA_VALIDATION_ERROR_CODES.INVALID_ENTITY,
          `${path}.${error.field}`,
          `${error.code}: ${error.message}`,
        ),
      );
    }
  }
  if (record.currency !== "USDT") {
    errors.push(
      createError(
        LEDGER_DATA_VALIDATION_ERROR_CODES.INVALID_ENTITY,
        `${path}.currency`,
        "V3 trade currency must be USDT",
      ),
    );
  }
  if (fee !== undefined && feeCurrency !== undefined) {
    if (isZero(fee) && feeCurrency !== "USDT") {
      errors.push(
        createError(
          LEDGER_DATA_VALIDATION_ERROR_CODES.INVALID_ENTITY,
          `${path}.feeCurrency`,
          "A zero fee must use USDT as feeCurrency",
        ),
      );
    } else if (
      !isZero(fee) &&
      feeCurrency !== "USDT" &&
      !assets.some(({ symbol }) => symbol === feeCurrency)
    ) {
      errors.push(
        createError(
          LEDGER_DATA_VALIDATION_ERROR_CODES.INVALID_REFERENCE,
          `${path}.feeCurrency`,
          `Unknown fee asset: ${feeCurrency}`,
        ),
      );
    }
  }
  if (
    errors.length !== errorCount ||
    id === undefined ||
    feeCurrency === undefined ||
    occurredAt === undefined ||
    createdAt === undefined ||
    updatedAt === undefined ||
    quantity === undefined ||
    price === undefined ||
    totalValue === undefined ||
    fee === undefined ||
    !validationResult.ok
  ) {
    return undefined;
  }
  const normalized = validationResult.value;
  return {
    id,
    occurredAt,
    timePrecision: normalized.timePrecision,
    type: normalized.type,
    assetSymbol: normalized.assetSymbol,
    quantity,
    ...(quantitySortKey === undefined ? {} : { quantitySortKey }),
    price,
    totalValue,
    ...(totalValueSortKey === undefined ? {} : { totalValueSortKey }),
    currency: "USDT",
    fee,
    feeCurrency,
    ...(normalized.platform === undefined
      ? {}
      : { platform: normalized.platform }),
    ...(normalized.feeRuleId === undefined
      ? {}
      : { feeRuleId: normalized.feeRuleId }),
    ...(normalized.note === undefined ? {} : { note: normalized.note }),
    ...(normalized.rawText === undefined
      ? {}
      : { rawText: normalized.rawText }),
    createdAt,
    updatedAt,
  };
}

function readCashEvent(
  value: unknown,
  index: number,
  errors: LedgerDataValidationError[],
): CashEvent | undefined {
  const path = `cashEvents[${index}]`;
  const record = readEntityRecord(value, path, errors);
  if (!record) return undefined;
  const errorCount = errors.length;
  const flowType =
    record.type === "deposit" ||
    record.type === "withdrawal" ||
    record.type === "external-expense";
  const adjustmentType = record.type === "balance-adjustment";
  checkAllowedKeys(
    record,
    adjustmentType
      ? CASH_ADJUSTMENT_KEYS
      : flowType
        ? CASH_FLOW_KEYS
        : CASH_BASE_KEYS,
    path,
    errors,
  );
  if (!flowType && !adjustmentType) {
    errors.push(
      createError(
        LEDGER_DATA_VALIDATION_ERROR_CODES.INVALID_ENTITY,
        `${path}.type`,
        "Cash event type is unsupported",
      ),
    );
  }
  const id = readTechnicalId(record.id, `${path}.id`, errors);
  const occurredAt = readFactTimestamp(
    record.occurredAt,
    `${path}.occurredAt`,
    errors,
  );
  const timePrecision = readTimePrecision(
    record.timePrecision,
    `${path}.timePrecision`,
    errors,
  );
  const currency = readUsdt(record.currency, `${path}.currency`, errors);
  const note = readOptionalString(record.note, `${path}.note`, errors);
  const createdAt = readTechnicalTimestamp(
    record.createdAt,
    `${path}.createdAt`,
    errors,
  );
  const updatedAt = readTechnicalTimestamp(
    record.updatedAt,
    `${path}.updatedAt`,
    errors,
  );
  validateTimestampOrder(createdAt, updatedAt, `${path}.updatedAt`, errors);

  if (flowType) {
    const amount = readCanonicalDecimal(
      record.amount,
      `${path}.amount`,
      errors,
      "positive",
    );
    if (
      errors.length !== errorCount ||
      id === undefined ||
      occurredAt === undefined ||
      timePrecision === undefined ||
      currency === undefined ||
      createdAt === undefined ||
      updatedAt === undefined ||
      amount === undefined
    ) {
      return undefined;
    }
    return {
      id,
      occurredAt,
      timePrecision,
      type: record.type as "deposit" | "withdrawal" | "external-expense",
      currency,
      amount,
      ...(note === undefined ? {} : { note }),
      createdAt,
      updatedAt,
    };
  }

  const balanceBefore = readCanonicalDecimal(
    record.balanceBefore,
    `${path}.balanceBefore`,
    errors,
  );
  const targetBalance = readCanonicalDecimal(
    record.targetBalance,
    `${path}.targetBalance`,
    errors,
  );
  const adjustmentAmount = readCanonicalDecimal(
    record.adjustmentAmount,
    `${path}.adjustmentAmount`,
    errors,
  );
  if (
    balanceBefore !== undefined &&
    targetBalance !== undefined &&
    adjustmentAmount !== undefined &&
    !isEqual(add(balanceBefore, adjustmentAmount), targetBalance)
  ) {
    errors.push(
      createError(
        LEDGER_DATA_VALIDATION_ERROR_CODES.INVALID_ENTITY,
        `${path}.adjustmentAmount`,
        "balanceBefore + adjustmentAmount must equal targetBalance",
      ),
    );
  }
  if (
    errors.length !== errorCount ||
    !adjustmentType ||
    id === undefined ||
    occurredAt === undefined ||
    timePrecision === undefined ||
    currency === undefined ||
    createdAt === undefined ||
    updatedAt === undefined ||
    balanceBefore === undefined ||
    targetBalance === undefined ||
    adjustmentAmount === undefined
  ) {
    return undefined;
  }
  return {
    id,
    occurredAt,
    timePrecision,
    type: "balance-adjustment",
    currency,
    balanceBefore,
    targetBalance,
    adjustmentAmount,
    ...(note === undefined ? {} : { note }),
    createdAt,
    updatedAt,
  };
}

function readPriceSnapshot(
  value: unknown,
  index: number,
  assets: readonly Asset[],
  errors: LedgerDataValidationError[],
): PriceSnapshot | undefined {
  const path = `priceSnapshots[${index}]`;
  const record = readEntityRecord(value, path, errors);
  if (!record) return undefined;
  const errorCount = errors.length;
  checkAllowedKeys(record, PRICE_KEYS, path, errors);
  const id = readTechnicalId(record.id, `${path}.id`, errors);
  const recordedAt = readFactTimestamp(
    record.recordedAt,
    `${path}.recordedAt`,
    errors,
  );
  const createdAt = readTechnicalTimestamp(
    record.createdAt,
    `${path}.createdAt`,
    errors,
  );
  const updatedAt = readTechnicalTimestamp(
    record.updatedAt,
    `${path}.updatedAt`,
    errors,
  );
  validateTimestampOrder(createdAt, updatedAt, `${path}.updatedAt`, errors);
  const price = readCanonicalDecimal(
    record.price,
    `${path}.price`,
    errors,
    "positive",
  );
  if (record.currency !== "USDT") {
    errors.push(
      createError(
        LEDGER_DATA_VALIDATION_ERROR_CODES.INVALID_ENTITY,
        `${path}.currency`,
        "V3 price currency must be USDT",
      ),
    );
  }
  if (record.binanceProvenance !== undefined) {
    readBinanceProvenance(
      record.binanceProvenance,
      `${path}.binanceProvenance`,
      errors,
    );
  }
  const validationResult = validatePriceSnapshotDraft(record, assets, {
    requiredCurrency: "USDT",
  });
  if (!validationResult.ok) {
    for (const error of validationResult.errors) {
      errors.push(
        createError(
          LEDGER_DATA_VALIDATION_ERROR_CODES.INVALID_ENTITY,
          `${path}.${error.field}`,
          `${error.code}: ${error.message}`,
        ),
      );
    }
  }
  if (
    errors.length !== errorCount ||
    id === undefined ||
    recordedAt === undefined ||
    createdAt === undefined ||
    updatedAt === undefined ||
    price === undefined ||
    !validationResult.ok
  ) {
    return undefined;
  }
  return {
    ...validationResult.value,
    id,
    price,
    currency: "USDT",
    recordedAt,
    createdAt,
    updatedAt,
  };
}

function readBinanceProvenance(
  value: unknown,
  path: string,
  errors: LedgerDataValidationError[],
): BinancePriceProvenance | undefined {
  if (!isRecord(value)) {
    errors.push(
      createError(
        LEDGER_DATA_VALIDATION_ERROR_CODES.INVALID_ENTITY,
        path,
        `${path} must be an object`,
      ),
    );
    return undefined;
  }
  const errorCount = errors.length;
  checkExactKeys(value, BINANCE_PROVENANCE_KEYS, path, errors);
  const symbol = readBoundedString(value.symbol, `${path}.symbol`, 64, errors);
  const fetchedAt = readTechnicalTimestamp(
    value.fetchedAt,
    `${path}.fetchedAt`,
    errors,
  );
  if (value.provider !== "binance" || value.sourceQuoteCurrency !== "USDT") {
    errors.push(
      createError(
        LEDGER_DATA_VALIDATION_ERROR_CODES.INVALID_ENTITY,
        path,
        "Binance provenance must use binance and USDT",
      ),
    );
  }
  if (
    errors.length !== errorCount ||
    symbol === undefined ||
    fetchedAt === undefined ||
    value.provider !== "binance" ||
    value.sourceQuoteCurrency !== "USDT"
  ) {
    return undefined;
  }
  return {
    provider: "binance",
    symbol,
    sourceQuoteCurrency: "USDT",
    fetchedAt,
  };
}

function readFeeRule(
  value: unknown,
  index: number,
  assets: readonly Asset[],
  errors: LedgerDataValidationError[],
): FeeRule | undefined {
  const path = `feeRules[${index}]`;
  const record = readEntityRecord(value, path, errors);
  if (!record) return undefined;
  const errorCount = errors.length;
  checkAllowedKeys(
    record,
    record.type === "fixed"
      ? FIXED_FEE_RULE_KEYS
      : record.type === "percentage"
        ? PERCENTAGE_FEE_RULE_KEYS
        : FEE_RULE_BASE_KEYS,
    path,
    errors,
  );
  const id = readTechnicalId(record.id, `${path}.id`, errors);
  const name = readRequiredString(record.name, `${path}.name`, errors);
  const platform = readPersistedString(
    record.platform,
    `${path}.platform`,
    errors,
  );
  const assetSymbol = readAssetSymbol(
    record.assetSymbol,
    `${path}.assetSymbol`,
    errors,
  );
  const createdAt = readTechnicalTimestamp(
    record.createdAt,
    `${path}.createdAt`,
    errors,
  );
  const updatedAt = readTechnicalTimestamp(
    record.updatedAt,
    `${path}.updatedAt`,
    errors,
  );
  const deactivatedAt = readOptionalTechnicalTimestamp(
    record.deactivatedAt,
    `${path}.deactivatedAt`,
    errors,
  );
  const replacesFeeRuleId = readOptionalTechnicalId(
    record.replacesFeeRuleId,
    `${path}.replacesFeeRuleId`,
    errors,
  );
  validateTimestampOrder(createdAt, updatedAt, `${path}.updatedAt`, errors);
  if (
    assetSymbol !== undefined &&
    !assets.some(({ symbol }) => symbol === assetSymbol)
  ) {
    errors.push(
      createError(
        LEDGER_DATA_VALIDATION_ERROR_CODES.INVALID_REFERENCE,
        `${path}.assetSymbol`,
        `Unknown asset: ${assetSymbol}`,
      ),
    );
  }
  const status =
    record.status === "active" || record.status === "inactive"
      ? record.status
      : undefined;
  if (status === undefined) {
    errors.push(
      createError(
        LEDGER_DATA_VALIDATION_ERROR_CODES.INVALID_ENTITY,
        `${path}.status`,
        "Fee rule status must be active or inactive",
      ),
    );
  }
  if (status === "active" && deactivatedAt !== undefined) {
    errors.push(
      createError(
        LEDGER_DATA_VALIDATION_ERROR_CODES.INVALID_ENTITY,
        `${path}.deactivatedAt`,
        "An active fee rule cannot have deactivatedAt",
      ),
    );
  }
  if (status === "inactive" && deactivatedAt === undefined) {
    errors.push(
      createError(
        LEDGER_DATA_VALIDATION_ERROR_CODES.INVALID_ENTITY,
        `${path}.deactivatedAt`,
        "An inactive fee rule must have deactivatedAt",
      ),
    );
  }
  if (record.currency !== "USDT") {
    errors.push(
      createError(
        LEDGER_DATA_VALIDATION_ERROR_CODES.INVALID_ENTITY,
        `${path}.currency`,
        "Fee rule currency must be USDT",
      ),
    );
  }
  const amount =
    record.type === "fixed"
      ? readCanonicalDecimal(
          record.amount,
          `${path}.amount`,
          errors,
          "non-negative",
        )
      : undefined;
  const rate =
    record.type === "percentage"
      ? readCanonicalDecimal(
          record.rate,
          `${path}.rate`,
          errors,
          "non-negative",
        )
      : undefined;
  if (record.type !== "fixed" && record.type !== "percentage") {
    errors.push(
      createError(
        LEDGER_DATA_VALIDATION_ERROR_CODES.INVALID_ENTITY,
        `${path}.type`,
        "Fee rule type must be fixed or percentage",
      ),
    );
  }
  if (
    errors.length !== errorCount ||
    id === undefined ||
    name === undefined ||
    platform === undefined ||
    assetSymbol === undefined ||
    createdAt === undefined ||
    updatedAt === undefined ||
    status === undefined ||
    (record.type === "fixed" && amount === undefined) ||
    (record.type === "percentage" && rate === undefined)
  ) {
    return undefined;
  }
  const common = {
    id,
    name,
    platform,
    assetSymbol,
    status: status as FeeRule["status"],
    createdAt,
    updatedAt,
    ...(deactivatedAt === undefined ? {} : { deactivatedAt }),
    ...(replacesFeeRuleId === undefined ? {} : { replacesFeeRuleId }),
  };
  return record.type === "fixed"
    ? { ...common, type: "fixed", amount: amount!, currency: "USDT" }
    : { ...common, type: "percentage", rate: rate!, currency: "USDT" };
}

function validateGlobalIdentifiers(
  collections: Pick<
    LedgerData,
    "assets" | "trades" | "cashEvents" | "priceSnapshots" | "feeRules"
  >,
  errors: LedgerDataValidationError[],
): void {
  const firstPathById = new Map<string, string>();
  for (const [collection, entities] of Object.entries(collections)) {
    entities.forEach(({ id }, index) => {
      const path = `${collection}[${index}].id`;
      const firstPath = firstPathById.get(id);
      if (firstPath !== undefined) {
        errors.push(
          createError(
            LEDGER_DATA_VALIDATION_ERROR_CODES.DUPLICATE_IDENTIFIER,
            path,
            `Duplicate id ${id}; first used at ${firstPath}`,
          ),
        );
      } else {
        firstPathById.set(id, path);
      }
    });
  }
}

function validateUniqueAssetSymbols(
  assets: readonly Asset[],
  errors: LedgerDataValidationError[],
): void {
  const firstIndexBySymbol = new Map<string, number>();
  assets.forEach((asset, index) => {
    const firstIndex = firstIndexBySymbol.get(asset.symbol);
    if (firstIndex !== undefined) {
      errors.push(
        createError(
          LEDGER_DATA_VALIDATION_ERROR_CODES.DUPLICATE_ASSET_SYMBOL,
          `assets[${index}].symbol`,
          `Duplicate asset symbol ${asset.symbol}; first used at assets[${firstIndex}]`,
        ),
      );
    } else {
      firstIndexBySymbol.set(asset.symbol, index);
    }
  });
}

function validateReferences(
  trades: readonly Trade[],
  priceSnapshots: readonly PriceSnapshot[],
  feeRules: readonly FeeRule[],
  assets: readonly Asset[],
  errors: LedgerDataValidationError[],
): void {
  const assetSymbols = new Set(assets.map(({ symbol }) => symbol));
  const feeRulesById = new Map(feeRules.map((rule) => [rule.id, rule]));
  priceSnapshots.forEach((snapshot, index) => {
    if (!assetSymbols.has(snapshot.assetSymbol)) {
      errors.push(
        createError(
          LEDGER_DATA_VALIDATION_ERROR_CODES.INVALID_REFERENCE,
          `priceSnapshots[${index}].assetSymbol`,
          `Unknown asset: ${snapshot.assetSymbol}`,
        ),
      );
    }
  });
  trades.forEach((trade, index) => {
    if (!assetSymbols.has(trade.assetSymbol)) {
      errors.push(
        createError(
          LEDGER_DATA_VALIDATION_ERROR_CODES.INVALID_REFERENCE,
          `trades[${index}].assetSymbol`,
          `Unknown asset: ${trade.assetSymbol}`,
        ),
      );
    }
    if (
      !isZero(trade.fee) &&
      trade.feeCurrency !== "USDT" &&
      !assetSymbols.has(trade.feeCurrency)
    ) {
      errors.push(
        createError(
          LEDGER_DATA_VALIDATION_ERROR_CODES.INVALID_REFERENCE,
          `trades[${index}].feeCurrency`,
          `Unknown fee asset: ${trade.feeCurrency}`,
        ),
      );
    }
    if (trade.feeRuleId !== undefined) {
      const rule = feeRulesById.get(trade.feeRuleId);
      if (!rule) {
        errors.push(
          createError(
            LEDGER_DATA_VALIDATION_ERROR_CODES.INVALID_REFERENCE,
            `trades[${index}].feeRuleId`,
            `Unknown fee rule: ${trade.feeRuleId}`,
          ),
        );
      } else if (
        rule.assetSymbol !== trade.assetSymbol ||
        rule.platform !== trade.platform
      ) {
        errors.push(
          createError(
            LEDGER_DATA_VALIDATION_ERROR_CODES.INVALID_REFERENCE,
            `trades[${index}].feeRuleId`,
            "Fee rule must match the trade platform and asset",
          ),
        );
      }
    }
  });
  feeRules.forEach((feeRule, index) => {
    const path = `feeRules[${index}]`;
    if (!assetSymbols.has(feeRule.assetSymbol)) {
      errors.push(
        createError(
          LEDGER_DATA_VALIDATION_ERROR_CODES.INVALID_REFERENCE,
          `${path}.assetSymbol`,
          `Unknown asset: ${feeRule.assetSymbol}`,
        ),
      );
    }
    if (feeRule.replacesFeeRuleId === undefined) return;
    const replaced = feeRulesById.get(feeRule.replacesFeeRuleId);
    if (!replaced) {
      errors.push(
        createError(
          LEDGER_DATA_VALIDATION_ERROR_CODES.INVALID_REFERENCE,
          `${path}.replacesFeeRuleId`,
          `Unknown replaced fee rule: ${feeRule.replacesFeeRuleId}`,
        ),
      );
    } else if (
      replaced.id === feeRule.id ||
      replaced.status !== "inactive" ||
      replaced.platform !== feeRule.platform ||
      replaced.assetSymbol !== feeRule.assetSymbol
    ) {
      errors.push(
        createError(
          LEDGER_DATA_VALIDATION_ERROR_CODES.INVALID_REFERENCE,
          `${path}.replacesFeeRuleId`,
          "A replacement must reference a different inactive rule with the same platform and asset",
        ),
      );
    }
  });
  feeRules.forEach((feeRule, index) => {
    const visited = new Set<string>();
    let current: FeeRule | undefined = feeRule;
    while (current?.replacesFeeRuleId !== undefined) {
      if (visited.has(current.id)) {
        errors.push(
          createError(
            LEDGER_DATA_VALIDATION_ERROR_CODES.INVALID_REFERENCE,
            `feeRules[${index}].replacesFeeRuleId`,
            "Fee rule replacement links must not form a cycle",
          ),
        );
        break;
      }
      visited.add(current.id);
      current = feeRulesById.get(current.replacesFeeRuleId);
    }
  });
}

function readEntityRecord(
  value: unknown,
  path: string,
  errors: LedgerDataValidationError[],
): Record<string, unknown> | undefined {
  if (isRecord(value)) return value;
  errors.push(
    createError(
      LEDGER_DATA_VALIDATION_ERROR_CODES.INVALID_ENTITY,
      path,
      `${path} must be an object`,
    ),
  );
  return undefined;
}

function readRequiredString(
  value: unknown,
  path: string,
  errors: LedgerDataValidationError[],
): string | undefined {
  if (typeof value === "string" && value.length > 0) return value;
  errors.push(
    createError(
      LEDGER_DATA_VALIDATION_ERROR_CODES.INVALID_ENTITY,
      path,
      `${path} must be a non-empty string`,
    ),
  );
  return undefined;
}

function readBoundedString(
  value: unknown,
  path: string,
  limit: number,
  errors: LedgerDataValidationError[],
): string | undefined {
  const text = readRequiredString(value, path, errors);
  if (text === undefined) return undefined;
  if (text.trim() !== text || text.length > limit) {
    errors.push(
      createError(
        LEDGER_DATA_VALIDATION_ERROR_CODES.INVALID_ENTITY,
        path,
        `${path} must be trimmed and at most ${limit} characters`,
      ),
    );
    return undefined;
  }
  return text;
}

function readTechnicalId(
  value: unknown,
  path: string,
  errors: LedgerDataValidationError[],
): string | undefined {
  return readBoundedString(value, path, 128, errors);
}

function readOptionalTechnicalId(
  value: unknown,
  path: string,
  errors: LedgerDataValidationError[],
): string | undefined {
  return value === undefined ? undefined : readTechnicalId(value, path, errors);
}

function readPersistedString(
  value: unknown,
  path: string,
  errors: LedgerDataValidationError[],
): string | undefined {
  const text = readRequiredString(value, path, errors);
  if (text === undefined) return undefined;
  if (text.trim() === text) return text;
  errors.push(
    createError(
      LEDGER_DATA_VALIDATION_ERROR_CODES.INVALID_ENTITY,
      path,
      `${path} must not contain surrounding whitespace`,
    ),
  );
  return undefined;
}

function readOptionalString(
  value: unknown,
  path: string,
  errors: LedgerDataValidationError[],
): string | undefined {
  if (value === undefined) return undefined;
  if (typeof value === "string") return value;
  errors.push(
    createError(
      LEDGER_DATA_VALIDATION_ERROR_CODES.INVALID_ENTITY,
      path,
      `${path} must be a string when provided`,
    ),
  );
  return undefined;
}

function readAssetSymbol(
  value: unknown,
  path: string,
  errors: LedgerDataValidationError[],
): string | undefined {
  if (
    typeof value === "string" &&
    ASSET_SYMBOL_PATTERN.test(value) &&
    value !== "USDT"
  ) {
    return value;
  }
  errors.push(
    createError(
      LEDGER_DATA_VALIDATION_ERROR_CODES.INVALID_ENTITY,
      path,
      `${path} must be an uppercase alphanumeric asset symbol other than USDT`,
    ),
  );
  return undefined;
}

function readUsdt(
  value: unknown,
  path: string,
  errors: LedgerDataValidationError[],
): "USDT" | undefined {
  if (value === "USDT") return "USDT";
  errors.push(
    createError(
      LEDGER_DATA_VALIDATION_ERROR_CODES.INVALID_ENTITY,
      path,
      `${path} must be USDT`,
    ),
  );
  return undefined;
}

function readFactTimestamp(
  value: unknown,
  path: string,
  errors: LedgerDataValidationError[],
): string | undefined {
  if (isValidISODateOrDateTime(value)) return value;
  errors.push(
    createError(
      LEDGER_DATA_VALIDATION_ERROR_CODES.INVALID_ENTITY,
      path,
      `${path} must be a strict ISO date or datetime`,
    ),
  );
  return undefined;
}

function readTechnicalTimestamp(
  value: unknown,
  path: string,
  errors: LedgerDataValidationError[],
): string | undefined {
  if (
    typeof value === "string" &&
    value.includes("T") &&
    isValidISODateOrDateTime(value)
  ) {
    return value;
  }
  errors.push(
    createError(
      LEDGER_DATA_VALIDATION_ERROR_CODES.INVALID_ENTITY,
      path,
      `${path} must be a strict ISO datetime with timezone`,
    ),
  );
  return undefined;
}

function readOptionalTechnicalTimestamp(
  value: unknown,
  path: string,
  errors: LedgerDataValidationError[],
): string | undefined {
  return value === undefined
    ? undefined
    : readTechnicalTimestamp(value, path, errors);
}

function validateTimestampOrder(
  createdAt: string | undefined,
  updatedAt: string | undefined,
  path: string,
  errors: LedgerDataValidationError[],
): void {
  if (
    createdAt !== undefined &&
    updatedAt !== undefined &&
    Date.parse(updatedAt) < Date.parse(createdAt)
  ) {
    errors.push(
      createError(
        LEDGER_DATA_VALIDATION_ERROR_CODES.INVALID_ENTITY,
        path,
        "updatedAt must not be earlier than createdAt",
      ),
    );
  }
}

function readTimePrecision(
  value: unknown,
  path: string,
  errors: LedgerDataValidationError[],
): "day" | "minute" | "second" | undefined {
  if (value === "day" || value === "minute" || value === "second") {
    return value;
  }
  errors.push(
    createError(
      LEDGER_DATA_VALIDATION_ERROR_CODES.INVALID_ENTITY,
      path,
      `${path} must be day, minute, or second`,
    ),
  );
  return undefined;
}

function readOptionalDecimals(
  value: unknown,
  path: string,
  errors: LedgerDataValidationError[],
): number | undefined {
  if (value === undefined) return undefined;
  if (typeof value === "number" && Number.isInteger(value) && value >= 0) {
    return value;
  }
  errors.push(
    createError(
      LEDGER_DATA_VALIDATION_ERROR_CODES.INVALID_ENTITY,
      path,
      `${path} must be a non-negative integer when provided`,
    ),
  );
  return undefined;
}

function readOptionalCanonicalDecimal(
  value: unknown,
  path: string,
  errors: LedgerDataValidationError[],
): string | undefined {
  return value === undefined
    ? undefined
    : readCanonicalDecimal(value, path, errors);
}

function readCanonicalDecimal(
  value: unknown,
  path: string,
  errors: LedgerDataValidationError[],
  sign: "any" | "positive" | "non-negative" = "any",
): string | undefined {
  if (
    typeof value !== "string" ||
    !DECIMAL_PATTERN.test(value) ||
    /^-0(?:\.0+)?$/.test(value)
  ) {
    errors.push(
      createError(
        LEDGER_DATA_VALIDATION_ERROR_CODES.INVALID_ENTITY,
        path,
        `${path} must use the canonical DecimalString grammar`,
      ),
    );
    return undefined;
  }
  const unsigned = value.startsWith("-") ? value.slice(1) : value;
  const [integer, fraction = ""] = unsigned.split(".");
  const significantDigits =
    `${integer === "0" ? "" : integer}${fraction}`.replace(/^0+/, "")
      .length || 1;
  if (significantDigits > 40 || fraction.length > 18) {
    errors.push(
      createError(
        LEDGER_DATA_VALIDATION_ERROR_CODES.INVALID_ENTITY,
        path,
        `${path} exceeds 40 significant digits or 18 decimal places`,
      ),
    );
    return undefined;
  }
  if (sign === "positive" && !isPositive(value)) {
    errors.push(
      createError(
        LEDGER_DATA_VALIDATION_ERROR_CODES.INVALID_ENTITY,
        path,
        `${path} must be greater than 0`,
      ),
    );
    return undefined;
  }
  if (sign === "non-negative" && isNegative(value)) {
    errors.push(
      createError(
        LEDGER_DATA_VALIDATION_ERROR_CODES.INVALID_ENTITY,
        path,
        `${path} must be non-negative`,
      ),
    );
    return undefined;
  }
  return value;
}

function checkExactKeys(
  value: Record<string, unknown>,
  expectedKeys: readonly string[],
  path: string,
  errors: LedgerDataValidationError[],
): void {
  checkAllowedKeys(value, expectedKeys, path, errors);
  for (const key of expectedKeys) {
    if (!(key in value)) {
      errors.push(
        createError(
          LEDGER_DATA_VALIDATION_ERROR_CODES.INVALID_ENTITY,
          `${path}.${key}`,
          `Missing field: ${key}`,
        ),
      );
    }
  }
}

function checkAllowedKeys(
  value: Record<string, unknown>,
  allowedKeys: readonly string[],
  path: string,
  errors: LedgerDataValidationError[],
): void {
  const allowed = new Set(allowedKeys);
  for (const key of Object.keys(value)) {
    if (!allowed.has(key)) {
      errors.push(
        createError(
          LEDGER_DATA_VALIDATION_ERROR_CODES.INVALID_ENTITY,
          `${path}.${key}`,
          `Unknown field: ${key}`,
        ),
      );
    }
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function createError(
  code: LedgerDataValidationError["code"],
  path: string,
  message: string,
): LedgerDataValidationError {
  return { code, path, message };
}
