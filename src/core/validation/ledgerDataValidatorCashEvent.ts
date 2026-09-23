import type { CashEvent } from "@/core/models";
import { add, isEqual } from "@/core/shared";
import {
  readEntityRecord,
  readTechnicalId,
  readOptionalString,
  readOptionalOccurredTimeZone,
  validateOccurredTimeZoneOffset,
  readUsdt,
  readFactTimestamp,
  readTechnicalTimestamp,
  validateTimestampOrder,
  readTimePrecision,
  readCanonicalDecimal,
  checkAllowedKeys,
  createError,
} from "./ledgerDataValidatorReaders";
import type { LedgerDataValidationError } from "./ledgerDataValidatorSchema";
import {
  LEDGER_DATA_VALIDATION_ERROR_CODES,
  CASH_BASE_KEYS,
  CASH_FLOW_KEYS,
  CASH_ADJUSTMENT_KEYS,
} from "./ledgerDataValidatorSchema";

export function readCashEvent(
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
  const occurredTimeZone = readOptionalOccurredTimeZone(
    record.occurredTimeZone,
    `${path}.occurredTimeZone`,
    errors,
  );
  validateOccurredTimeZoneOffset(occurredAt, occurredTimeZone, `${path}.occurredAt`, errors);
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
      ...(occurredTimeZone === undefined ? {} : { occurredTimeZone }),
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
    ...(occurredTimeZone === undefined ? {} : { occurredTimeZone }),
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
