import { calculatePositions } from "../calculators/positionCalculator";
import type {
  Asset,
  FeeRule,
  LedgerData,
  PriceSnapshot,
  Trade,
} from "../models";
import { isNegative, toDecimal } from "../utils/decimalMath";
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
  | {
      ok: true;
      value: LedgerData;
    }
  | {
      ok: false;
      errors: LedgerDataValidationError[];
    };

/**
 * JSON / IndexedDB 数据进入 reducer 前的完整运行时边界。
 *
 * 成功结果是重新构造的 LedgerData，不会把未知字段带入应用状态。
 */
export function validateLedgerData(
  input: unknown,
): LedgerDataValidationResult {
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

  if (input.schemaVersion !== 1) {
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
  const rawPriceSnapshots = readCollection(input, "priceSnapshots", errors);
  const rawFeeRules = readCollection(input, "feeRules", errors);

  if (
    rawAssets === undefined ||
    rawTrades === undefined ||
    rawPriceSnapshots === undefined ||
    rawFeeRules === undefined
  ) {
    return { ok: false, errors };
  }

  const assets = rawAssets
    .map((value, index) => readAsset(value, index, errors))
    .filter((value): value is Asset => value !== undefined);
  const feeRules = rawFeeRules
    .map((value, index) => readFeeRule(value, index, errors))
    .filter((value): value is FeeRule => value !== undefined);
  const trades = rawTrades
    .map((value, index) => readTrade(value, index, assets, errors))
    .filter((value): value is Trade => value !== undefined);
  const priceSnapshots = rawPriceSnapshots
    .map((value, index) =>
      readPriceSnapshot(value, index, assets, errors),
    )
    .filter((value): value is PriceSnapshot => value !== undefined);

  validateUniqueIdentifiers(assets, "assets", errors);
  validateUniqueIdentifiers(trades, "trades", errors);
  validateUniqueIdentifiers(priceSnapshots, "priceSnapshots", errors);
  validateUniqueIdentifiers(feeRules, "feeRules", errors);
  validateUniqueAssetSymbols(assets, errors);
  validateFeeRuleReferences(trades, feeRules, errors);

  if (
    errors.length === 0 &&
    assets.length === rawAssets.length &&
    trades.length === rawTrades.length &&
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
      schemaVersion: 1,
      assets,
      trades,
      priceSnapshots,
      feeRules,
    },
  };
}

function readCollection(
  input: Record<string, unknown>,
  field: "assets" | "trades" | "priceSnapshots" | "feeRules",
  errors: LedgerDataValidationError[],
): unknown[] | undefined {
  const value = input[field];

  if (Array.isArray(value)) {
    return value;
  }

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

  if (!record) {
    return undefined;
  }

  const errorCount = errors.length;
  const id = readRequiredString(record.id, `${path}.id`, errors);
  const symbol = readRequiredString(record.symbol, `${path}.symbol`, errors);
  const name = readRequiredString(record.name, `${path}.name`, errors);
  const quoteCurrency = readRequiredString(
    record.quoteCurrency,
    `${path}.quoteCurrency`,
    errors,
  );
  const createdAt = readISODate(record.createdAt, `${path}.createdAt`, errors);
  const updatedAt = readISODate(record.updatedAt, `${path}.updatedAt`, errors);
  const decimals = readOptionalDecimals(
    record.decimals,
    `${path}.decimals`,
    errors,
  );

  if (
    errors.length !== errorCount ||
    id === undefined ||
    symbol === undefined ||
    name === undefined ||
    quoteCurrency === undefined ||
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
    createdAt,
    updatedAt,
  };
}

function readTrade(
  value: unknown,
  index: number,
  assets: readonly Asset[],
  errors: LedgerDataValidationError[],
): Trade | undefined {
  const path = `trades[${index}]`;
  const record = readEntityRecord(value, path, errors);

  if (!record) {
    return undefined;
  }

  const errorCount = errors.length;
  const id = readRequiredString(record.id, `${path}.id`, errors);
  const feeCurrency = readRequiredString(
    record.feeCurrency,
    `${path}.feeCurrency`,
    errors,
  );
  const occurredAt = readISODate(
    record.occurredAt,
    `${path}.occurredAt`,
    errors,
  );
  const createdAt = readISODate(record.createdAt, `${path}.createdAt`, errors);
  const updatedAt = readISODate(record.updatedAt, `${path}.updatedAt`, errors);
  const quantitySortKey = readOptionalDecimal(
    record.quantitySortKey,
    `${path}.quantitySortKey`,
    errors,
  );
  const totalValueSortKey = readOptionalDecimal(
    record.totalValueSortKey,
    `${path}.totalValueSortKey`,
    errors,
  );
  const validationResult = validateTradeDraft(record, {
    assets,
    priorTrades: [],
    skipHoldingsTimeline: true,
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
    feeCurrency === undefined ||
    occurredAt === undefined ||
    createdAt === undefined ||
    updatedAt === undefined ||
    !validationResult.ok
  ) {
    return undefined;
  }

  return {
    ...validationResult.value,
    id,
    occurredAt,
    feeCurrency,
    ...(quantitySortKey === undefined ? {} : { quantitySortKey }),
    ...(totalValueSortKey === undefined ? {} : { totalValueSortKey }),
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

  if (!record) {
    return undefined;
  }

  const errorCount = errors.length;
  const id = readRequiredString(record.id, `${path}.id`, errors);
  const recordedAt = readISODate(
    record.recordedAt,
    `${path}.recordedAt`,
    errors,
  );
  const createdAt = readISODate(record.createdAt, `${path}.createdAt`, errors);
  const updatedAt = readISODate(record.updatedAt, `${path}.updatedAt`, errors);
  const validationResult = validatePriceSnapshotDraft(record, assets);

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
    !validationResult.ok
  ) {
    return undefined;
  }

  return {
    ...validationResult.value,
    id,
    recordedAt,
    createdAt,
    updatedAt,
  };
}

function readFeeRule(
  value: unknown,
  index: number,
  errors: LedgerDataValidationError[],
): FeeRule | undefined {
  const path = `feeRules[${index}]`;
  const record = readEntityRecord(value, path, errors);

  if (!record) {
    return undefined;
  }

  const errorCount = errors.length;
  const id = readRequiredString(record.id, `${path}.id`, errors);
  const name = readRequiredString(record.name, `${path}.name`, errors);
  const platform = readRequiredString(
    record.platform,
    `${path}.platform`,
    errors,
  );
  const rate = readNonNegativeDecimal(record.rate, `${path}.rate`, errors);
  const currency = readRequiredString(
    record.currency,
    `${path}.currency`,
    errors,
  );
  const createdAt = readISODate(record.createdAt, `${path}.createdAt`, errors);
  const updatedAt = readISODate(record.updatedAt, `${path}.updatedAt`, errors);

  if (record.type !== "percentage") {
    errors.push(
      createError(
        LEDGER_DATA_VALIDATION_ERROR_CODES.INVALID_ENTITY,
        `${path}.type`,
        "Fee rule type must be percentage",
      ),
    );
  }

  if (
    errors.length !== errorCount ||
    id === undefined ||
    name === undefined ||
    platform === undefined ||
    rate === undefined ||
    currency === undefined ||
    createdAt === undefined ||
    updatedAt === undefined ||
    record.type !== "percentage"
  ) {
    return undefined;
  }

  return {
    id,
    name,
    platform,
    type: "percentage",
    rate,
    currency,
    createdAt,
    updatedAt,
  };
}

function validateUniqueIdentifiers(
  entities: readonly { id: string }[],
  collection: "assets" | "trades" | "priceSnapshots" | "feeRules",
  errors: LedgerDataValidationError[],
) {
  const firstIndexById = new Map<string, number>();

  for (let index = 0; index < entities.length; index += 1) {
    const entity = entities[index];
    const firstIndex = firstIndexById.get(entity.id);

    if (firstIndex !== undefined) {
      errors.push(
        createError(
          LEDGER_DATA_VALIDATION_ERROR_CODES.DUPLICATE_IDENTIFIER,
          `${collection}[${index}].id`,
          `Duplicate id ${entity.id}; first used at ${collection}[${firstIndex}]`,
        ),
      );
      continue;
    }

    firstIndexById.set(entity.id, index);
  }
}

function validateUniqueAssetSymbols(
  assets: readonly Asset[],
  errors: LedgerDataValidationError[],
) {
  const firstIndexBySymbol = new Map<string, number>();

  for (let index = 0; index < assets.length; index += 1) {
    const asset = assets[index];
    const firstIndex = firstIndexBySymbol.get(asset.symbol);

    if (firstIndex !== undefined) {
      errors.push(
        createError(
          LEDGER_DATA_VALIDATION_ERROR_CODES.DUPLICATE_ASSET_SYMBOL,
          `assets[${index}].symbol`,
          `Duplicate asset symbol ${asset.symbol}; first used at assets[${firstIndex}]`,
        ),
      );
      continue;
    }

    firstIndexBySymbol.set(asset.symbol, index);
  }
}

function validateFeeRuleReferences(
  trades: readonly Trade[],
  feeRules: readonly FeeRule[],
  errors: LedgerDataValidationError[],
) {
  const feeRuleIds = new Set(feeRules.map((feeRule) => feeRule.id));

  for (let index = 0; index < trades.length; index += 1) {
    const trade = trades[index];
    if (trade.feeRuleId && !feeRuleIds.has(trade.feeRuleId)) {
      errors.push(
        createError(
          LEDGER_DATA_VALIDATION_ERROR_CODES.INVALID_REFERENCE,
          `trades[${index}].feeRuleId`,
          `Unknown fee rule: ${trade.feeRuleId}`,
        ),
      );
    }
  }
}

function readEntityRecord(
  value: unknown,
  path: string,
  errors: LedgerDataValidationError[],
): Record<string, unknown> | undefined {
  if (isRecord(value)) {
    return value;
  }

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
  if (typeof value === "string" && value.length > 0) {
    return value;
  }

  errors.push(
    createError(
      LEDGER_DATA_VALIDATION_ERROR_CODES.INVALID_ENTITY,
      path,
      `${path} must be a non-empty string`,
    ),
  );
  return undefined;
}

function readISODate(
  value: unknown,
  path: string,
  errors: LedgerDataValidationError[],
): string | undefined {
  const text = readRequiredString(value, path, errors);

  if (text === undefined) {
    return undefined;
  }

  if (isValidISODateOrDateTime(text)) {
    return text;
  }

  errors.push(
    createError(
      LEDGER_DATA_VALIDATION_ERROR_CODES.INVALID_ENTITY,
      path,
      `${path} must be a valid ISO date or datetime string`,
    ),
  );
  return undefined;
}

function readOptionalDecimals(
  value: unknown,
  path: string,
  errors: LedgerDataValidationError[],
): number | undefined {
  if (value === undefined) {
    return undefined;
  }

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

function readOptionalDecimal(
  value: unknown,
  path: string,
  errors: LedgerDataValidationError[],
): string | undefined {
  if (value === undefined) {
    return undefined;
  }

  if (typeof value === "string") {
    try {
      toDecimal(value);
      return value;
    } catch {
      // Fall through to the structured error below.
    }
  }

  errors.push(
    createError(
      LEDGER_DATA_VALIDATION_ERROR_CODES.INVALID_ENTITY,
      path,
      `${path} must be a valid finite decimal string when provided`,
    ),
  );
  return undefined;
}

function readNonNegativeDecimal(
  value: unknown,
  path: string,
  errors: LedgerDataValidationError[],
): string | undefined {
  if (typeof value === "string") {
    try {
      if (!isNegative(value)) {
        return value;
      }
    } catch {
      // Fall through to the structured error below.
    }
  }

  errors.push(
    createError(
      LEDGER_DATA_VALIDATION_ERROR_CODES.INVALID_ENTITY,
      path,
      `${path} must be a valid non-negative finite decimal string`,
    ),
  );
  return undefined;
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
