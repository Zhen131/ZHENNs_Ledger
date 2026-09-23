import type { Asset, Trade } from "@/core/models";
import { isZero } from "@/core/shared";
import { validateTradeDraft } from "./tradeValidator";
import {
  readEntityRecord,
  readBoundedString,
  readTechnicalId,
  readOptionalOccurredTimeZone,
  validateOccurredTimeZoneOffset,
  readFactTimestamp,
  readTechnicalTimestamp,
  validateTimestampOrder,
  readOptionalCanonicalDecimal,
  readCanonicalDecimal,
  checkAllowedKeys,
  createError,
} from "./ledgerDataValidatorReaders";
import type { LedgerDataValidationError } from "./ledgerDataValidatorSchema";
import {
  LEDGER_DATA_VALIDATION_ERROR_CODES,
  TRADE_KEYS,
} from "./ledgerDataValidatorSchema";

export function readTrade(
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
  const occurredTimeZone = readOptionalOccurredTimeZone(
    record.occurredTimeZone,
    `${path}.occurredTimeZone`,
    errors,
  );
  validateOccurredTimeZoneOffset(occurredAt, occurredTimeZone, `${path}.occurredAt`, errors);
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
        "V5 trade currency must be USDT",
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
    ...(occurredTimeZone === undefined ? {} : { occurredTimeZone }),
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
