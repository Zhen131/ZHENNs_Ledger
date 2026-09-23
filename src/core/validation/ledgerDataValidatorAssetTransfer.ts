import type {
  AssetTransfer,
  AssetTransferCategory,
  AssetTransferReason,
  CustodyLocation,
} from "@/core/models";
import {
  readEntityRecord,
  readTechnicalId,
  readOptionalString,
  readOptionalOccurredTimeZone,
  validateOccurredTimeZoneOffset,
  readAssetSymbol,
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
  ASSET_TRANSFER_KEYS,
} from "./ledgerDataValidatorSchema";

export function readAssetTransfer(
  value: unknown,
  index: number,
  errors: LedgerDataValidationError[],
): AssetTransfer | undefined {
  const path = `assetTransfers[${index}]`;
  const record = readEntityRecord(value, path, errors);
  if (!record) return undefined;
  const errorCount = errors.length;
  checkAllowedKeys(record, ASSET_TRANSFER_KEYS, path, errors);

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
  const assetSymbol = readAssetSymbol(
    record.assetSymbol,
    `${path}.assetSymbol`,
    errors,
  );
  const quantity = readCanonicalDecimal(
    record.quantity,
    `${path}.quantity`,
    errors,
    "positive",
  );
  const category = readAssetTransferCategory(
    record.category,
    `${path}.category`,
    errors,
  );
  const reason = readAssetTransferReason(
    record.reason,
    `${path}.reason`,
    errors,
  );
  const unitPrice =
    record.unitPrice === undefined
      ? undefined
      : readCanonicalDecimal(
          record.unitPrice,
          `${path}.unitPrice`,
          errors,
          "positive",
        );
  const networkFee =
    record.networkFee === undefined
      ? undefined
      : readCanonicalDecimal(
          record.networkFee,
          `${path}.networkFee`,
          errors,
          "positive",
        );
  const fromLocation = readOptionalCustodyLocation(
    record.fromLocation,
    `${path}.fromLocation`,
    errors,
  );
  const toLocation = readOptionalCustodyLocation(
    record.toLocation,
    `${path}.toLocation`,
    errors,
  );
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
  validateAssetTransferCombination(
    record,
    path,
    category,
    reason,
    unitPrice,
    fromLocation,
    toLocation,
    errors,
  );

  if (
    errors.length !== errorCount ||
    id === undefined ||
    occurredAt === undefined ||
    timePrecision === undefined ||
    assetSymbol === undefined ||
    quantity === undefined ||
    category === undefined ||
    reason === undefined ||
    createdAt === undefined ||
    updatedAt === undefined
  ) {
    return undefined;
  }

  return {
    id,
    occurredAt,
    ...(occurredTimeZone === undefined ? {} : { occurredTimeZone }),
    timePrecision,
    assetSymbol,
    quantity,
    category,
    reason,
    ...(unitPrice === undefined ? {} : { unitPrice }),
    ...(networkFee === undefined ? {} : { networkFee }),
    ...(fromLocation === undefined ? {} : { fromLocation }),
    ...(toLocation === undefined ? {} : { toLocation }),
    ...(note === undefined ? {} : { note }),
    createdAt,
    updatedAt,
  };
}

function validateAssetTransferCombination(
  record: Record<string, unknown>,
  path: string,
  category: AssetTransferCategory | undefined,
  reason: AssetTransferReason | undefined,
  unitPrice: string | undefined,
  fromLocation: CustodyLocation | undefined,
  toLocation: CustodyLocation | undefined,
  errors: LedgerDataValidationError[],
): void {
  if (category !== undefined) {
    switch (category) {
      case "internal":
        requireTransferField(fromLocation, `${path}.fromLocation`, errors);
        requireTransferField(toLocation, `${path}.toLocation`, errors);
        forbidTransferField(record, "unitPrice", path, errors);
        if (
          fromLocation !== undefined &&
          toLocation !== undefined &&
          fromLocation === toLocation
        ) {
          errors.push(
            createError(
              LEDGER_DATA_VALIDATION_ERROR_CODES.INVALID_ENTITY,
              `${path}.toLocation`,
              "internal toLocation must differ from fromLocation",
            ),
          );
        }
        break;
      case "external-in":
        forbidTransferField(record, "fromLocation", path, errors);
        requireTransferField(toLocation, `${path}.toLocation`, errors);
        requireTransferField(unitPrice, `${path}.unitPrice`, errors);
        forbidTransferField(record, "networkFee", path, errors);
        break;
      case "external-out":
        requireTransferField(fromLocation, `${path}.fromLocation`, errors);
        forbidTransferField(record, "toLocation", path, errors);
        forbidTransferField(record, "unitPrice", path, errors);
        break;
      case "gain":
        forbidTransferField(record, "fromLocation", path, errors);
        requireTransferField(toLocation, `${path}.toLocation`, errors);
        requireTransferField(unitPrice, `${path}.unitPrice`, errors);
        forbidTransferField(record, "networkFee", path, errors);
        break;
    }
  }

  if (
    category !== undefined &&
    reason !== undefined &&
    ASSET_TRANSFER_CATEGORY_BY_REASON[reason] !== category
  ) {
    errors.push(
      createError(
        LEDGER_DATA_VALIDATION_ERROR_CODES.INVALID_ENTITY,
        `${path}.reason`,
        `${reason} is not valid for ${category}`,
      ),
    );
  }
}

const ASSET_TRANSFER_CATEGORY_BY_REASON: Readonly<
  Record<AssetTransferReason, AssetTransferCategory>
> = {
  deposit: "external-in",
  withdrawal: "external-out",
  "internal-move": "internal",
  airdrop: "gain",
  interest: "gain",
  "platform-gift": "gain",
};

function requireTransferField(
  value: unknown,
  path: string,
  errors: LedgerDataValidationError[],
): void {
  if (value !== undefined) return;
  errors.push(
    createError(
      LEDGER_DATA_VALIDATION_ERROR_CODES.INVALID_ENTITY,
      path,
      `${path} is required for this asset transfer category`,
    ),
  );
}

function forbidTransferField(
  record: Record<string, unknown>,
  field: "fromLocation" | "toLocation" | "unitPrice" | "networkFee",
  path: string,
  errors: LedgerDataValidationError[],
): void {
  if (!Object.hasOwn(record, field)) return;
  errors.push(
    createError(
      LEDGER_DATA_VALIDATION_ERROR_CODES.INVALID_ENTITY,
      `${path}.${field}`,
      `${path}.${field} must be absent for this asset transfer category`,
    ),
  );
}

function readAssetTransferCategory(
  value: unknown,
  path: string,
  errors: LedgerDataValidationError[],
): AssetTransferCategory | undefined {
  if (
    value === "internal" ||
    value === "external-in" ||
    value === "external-out" ||
    value === "gain"
  ) {
    return value;
  }
  errors.push(
    createError(
      LEDGER_DATA_VALIDATION_ERROR_CODES.INVALID_ENTITY,
      path,
      `${path} must be internal, external-in, external-out, or gain`,
    ),
  );
  return undefined;
}

function readAssetTransferReason(
  value: unknown,
  path: string,
  errors: LedgerDataValidationError[],
): AssetTransferReason | undefined {
  if (
    value === "deposit" ||
    value === "withdrawal" ||
    value === "internal-move" ||
    value === "airdrop" ||
    value === "interest" ||
    value === "platform-gift"
  ) {
    return value;
  }
  errors.push(
    createError(
      LEDGER_DATA_VALIDATION_ERROR_CODES.INVALID_ENTITY,
      path,
      `${path} uses an unsupported asset transfer reason`,
    ),
  );
  return undefined;
}

function readOptionalCustodyLocation(
  value: unknown,
  path: string,
  errors: LedgerDataValidationError[],
): CustodyLocation | undefined {
  if (value === undefined) return undefined;
  if (
    value === "exchange" ||
    value === "cold-wallet" ||
    value === "cold-wallet-earn"
  ) {
    return value;
  }
  errors.push(
    createError(
      LEDGER_DATA_VALIDATION_ERROR_CODES.INVALID_ENTITY,
      path,
      `${path} must be exchange, cold-wallet, or cold-wallet-earn`,
    ),
  );
  return undefined;
}
