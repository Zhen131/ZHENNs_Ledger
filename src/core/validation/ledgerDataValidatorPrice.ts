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
