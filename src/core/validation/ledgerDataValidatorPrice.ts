/**
 * 这个文件管查整本账本时，一条记下来的价格对不对。
 * 它把能共用的检查交给 validatePriceSnapshotDraft，这里只补整本账本才有的字段。
 * 不显然的决定：价格币种只认 USDT。2026-08-19 定（W14 01B 第 3.1 节）。
 */

import type {
  Asset,
  BinancePriceProvenance,
  PriceSnapshot,
} from "@/core/models";
import { validatePriceSnapshotDraft } from "./priceSnapshotValidator";
import {
  readEntityRecord,
  readBoundedString,
  readTechnicalId,
  readOptionalOccurredTimeZone,
  validateOccurredTimeZoneOffset,
  readFactTimestamp,
  readTechnicalTimestamp,
  validateTimestampOrder,
  readCanonicalDecimal,
  checkExactKeys,
  checkAllowedKeys,
  isRecord,
  createError,
} from "./ledgerDataValidatorReaders";
import type { LedgerDataValidationError } from "./ledgerDataValidatorSchema";
import {
  LEDGER_DATA_VALIDATION_ERROR_CODES,
  PRICE_KEYS,
  BINANCE_PROVENANCE_KEYS,
} from "./ledgerDataValidatorSchema";

/**
 * 这个函数读出第几条记下来的价格，读不对就记错并答没有。
 * 它查编号、时间、时差和地点。
 * 还查价格大于 0、币种是 USDT、行情来历。
 * 举例：BTC、70000、USDT、2026-08-20 → 答通过；价格 0 → 答没有，记一条错。
 * 不抛错，错误放进传进来的列表。
 */
export function readPriceSnapshot(
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
  const occurredTimeZone = readOptionalOccurredTimeZone(
    record.occurredTimeZone,
    `${path}.occurredTimeZone`,
    errors,
  );
  validateOccurredTimeZoneOffset(recordedAt, occurredTimeZone, `${path}.recordedAt`, errors);
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
        "V5 price currency must be USDT",
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
    ...(occurredTimeZone === undefined ? {} : { occurredTimeZone }),
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
