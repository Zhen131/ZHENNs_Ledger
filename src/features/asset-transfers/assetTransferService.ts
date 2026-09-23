import { replayPositions } from "@/core/calculations";
import type {
  AssetTransfer,
  AssetTransferCategory,
  AssetTransferReason,
  CustodyLocation,
  ISODateTimeString,
  LedgerData,
} from "@/core/models";
import {
  captureLedgerTime,
  isPositive,
  isSupportedTimeZone,
  isTimePrecision,
  systemLedgerClock,
} from "@/core/shared";
import {
  isValidISODateOrDateTime,
  validateLedgerData,
} from "@/core/validation";
import { translateDefault } from "@/ui";
import type {
  AssetTransferServiceError,
  AssetTransferServiceDependencies,
  ValidateAssetTransferRemovalResult,
} from "./assetTransferServiceContract";
import {
  ASSET_TRANSFER_REASONS_BY_CATEGORY,
  ASSET_TRANSFER_SERVICE_ERROR_CODES,
} from "./assetTransferServiceContract";

const MAX_ID_ATTEMPTS = 3;
const DECIMAL_PATTERN = /^(?:0|[1-9]\d*)(?:\.\d+)?$/;

export type CreateAssetTransferResult =
  | { ok: true; assetTransfer: AssetTransfer }
  | AssetTransferFailure;

type AssetTransferFailure = {
  ok: false;
  error: AssetTransferServiceError;
};

export function createValidatedAssetTransfer(
  input: unknown,
  ledgerData: LedgerData,
  providedDependencies?: AssetTransferServiceDependencies,
): CreateAssetTransferResult {
  if (!isRecord(input)) {
    return failure("INVALID_INPUT", "form", translateDefault("assetTransfer.validation.invalidInput"));
  }
  if (!isAssetTransferCategory(input.category)) {
    return failure("INVALID_CATEGORY", "category", translateDefault("assetTransfer.validation.invalidCategory"));
  }
  const category = input.category;
  if (
    typeof input.assetSymbol !== "string" ||
    !ledgerData.assets.some((asset) => asset.symbol === input.assetSymbol)
  ) {
    return failure("INVALID_ASSET", "assetSymbol", translateDefault("assetTransfer.validation.invalidAsset"));
  }
  if (!isAssetTransferReason(input.reason)) {
    return failure("INVALID_REASON", "reason", translateDefault("assetTransfer.validation.invalidReason"));
  }
  if (
    !ASSET_TRANSFER_REASONS_BY_CATEGORY[category].some(
      (reason) => reason === input.reason,
    )
  ) {
    return failure("INVALID_REASON", "reason", translateDefault("assetTransfer.validation.reasonCategoryMismatch"));
  }
  if (
    typeof input.quantity !== "string" ||
    !isCanonicalDecimal(input.quantity) ||
    !isPositive(input.quantity)
  ) {
    return failure(
      "INVALID_QUANTITY",
      "quantity",
      translateDefault("assetTransfer.validation.invalidQuantity"),
    );
  }
  if (
    typeof input.occurredAt !== "string" ||
    !isValidISODateOrDateTime(input.occurredAt)
  ) {
    return failure("INVALID_DATE", "occurredAt", translateDefault("assetTransfer.validation.invalidDate"));
  }

  const defaultSnapshot = providedDependencies
    ? undefined
    : captureLedgerTime(systemLedgerClock);
  const dependencies = providedDependencies ?? {
    generateId: () => globalThis.crypto.randomUUID(),
    now: () => defaultSnapshot!.now.toISOString(),
    todayKey: () => defaultSnapshot!.todayKey,
  };
  let todayKey: string;
  try {
    todayKey = dependencies.todayKey();
  } catch {
    return failure("DEPENDENCY_FAILURE", "form", translateDefault("assetTransfer.validation.readTodayFailed"));
  }
  if (input.occurredAt.slice(0, 10) > todayKey) {
    return failure("FUTURE_FACT", "occurredAt", translateDefault("assetTransfer.validation.futureFact"));
  }
  const occurredTimeZone = input.occurredTimeZone;
  if (
    occurredTimeZone !== undefined &&
    (typeof occurredTimeZone !== "string" ||
      !isSupportedTimeZone(occurredTimeZone))
  ) {
    return failure("INVALID_DATE", "occurredAt", translateDefault("assetTransfer.validation.invalidTimeZone"));
  }
  const timePrecision = input.timePrecision;
  if (timePrecision !== undefined && !isTimePrecision(timePrecision)) {
    return failure("INVALID_DATE", "occurredAt", translateDefault("assetTransfer.validation.invalidTimePrecision"));
  }


  const unitPriceResult = readOptionalPositiveDecimal(
    input.unitPrice,
    "unitPrice",
    translateDefault("assetTransfer.validation.unitPrice"),
  );
  if (!unitPriceResult.ok) return unitPriceResult.result;
  const networkFeeResult = readOptionalPositiveDecimal(
    input.networkFee,
    "networkFee",
    translateDefault("assetTransfer.validation.networkFee"),
  );
  if (!networkFeeResult.ok) return networkFeeResult.result;
  const fromLocation = readOptionalLocation(input.fromLocation);
  if (fromLocation === "invalid") {
    return failure("INVALID_FROM_LOCATION", "fromLocation", translateDefault("assetTransfer.validation.invalidFromLocation"));
  }
  const toLocation = readOptionalLocation(input.toLocation);
  if (toLocation === "invalid") {
    return failure("INVALID_TO_LOCATION", "toLocation", translateDefault("assetTransfer.validation.invalidToLocation"));
  }

  const combinationError = validateCombination({
    category,
    unitPrice: unitPriceResult.value,
    networkFee: networkFeeResult.value,
    fromLocation,
    toLocation,
  });
  if (combinationError) return combinationError;

  if (input.note !== undefined && typeof input.note !== "string") {
    return failure("INVALID_NOTE", "note", translateDefault("assetTransfer.validation.invalidNote"));
  }
  const note =
    typeof input.note === "string" && input.note.trim() !== ""
      ? input.note.trim()
      : undefined;
  if (note !== undefined && note.length > 4_096) {
    return failure("NOTE_TOO_LONG", "note", translateDefault("assetTransfer.validation.noteTooLong"));
  }

  const existingIds = collectLedgerIds(ledgerData);
  let id: string | undefined;
  for (let attempt = 0; attempt < MAX_ID_ATTEMPTS; attempt += 1) {
    let candidate: string;
    try {
      candidate = dependencies.generateId();
    } catch {
      return failure("DEPENDENCY_FAILURE", "form", translateDefault("assetTransfer.validation.generateIdFailed"));
    }
    if (isTechnicalId(candidate) && !existingIds.has(candidate)) {
      id = candidate;
      break;
    }
  }
  if (id === undefined) {
    return failure(
      "ID_GENERATION_EXHAUSTED",
      "form",
      translateDefault("assetTransfer.validation.generateIdExhausted"),
    );
  }

  let timestamp: ISODateTimeString;
  try {
    timestamp = dependencies.now();
  } catch {
    return failure("DEPENDENCY_FAILURE", "form", translateDefault("assetTransfer.validation.readSaveTimeFailed"));
  }

  const common = {
    id,
    occurredAt: input.occurredAt,
    ...(occurredTimeZone === undefined ? {} : { occurredTimeZone }),
    timePrecision:
      timePrecision ??
      (input.occurredAt.includes("T")
        ? ("second" as const)
        : ("day" as const)),
    assetSymbol: input.assetSymbol,
    quantity: input.quantity,
    category,
    reason: input.reason,
    ...(note === undefined ? {} : { note }),
    createdAt: timestamp,
    updatedAt: timestamp,
  };
  let assetTransfer: AssetTransfer;
  if (category === "internal") {
    assetTransfer = {
      ...common,
      category,
      fromLocation: fromLocation!,
      toLocation: toLocation!,
      ...(networkFeeResult.value === undefined
        ? {}
        : { networkFee: networkFeeResult.value }),
    };
  } else if (category === "external-out") {
    assetTransfer = {
      ...common,
      category,
      fromLocation: fromLocation!,
      ...(networkFeeResult.value === undefined
        ? {}
        : { networkFee: networkFeeResult.value }),
    };
  } else {
    assetTransfer = {
      ...common,
      category,
      toLocation: toLocation!,
      unitPrice: unitPriceResult.value!,
    };
  }

  const nextLedger: LedgerData = {
    ...ledgerData,
    assetTransfers: [...ledgerData.assetTransfers, assetTransfer],
  };
  try {
    replayPositions(nextLedger.trades, nextLedger.assetTransfers);
  } catch {
    return failure(
      "INSUFFICIENT_HOLDING",
      "quantity",
      translateDefault("assetTransfer.validation.insufficientHolding"),
    );
  }

  const validation = validateLedgerData(nextLedger);
  if (!validation.ok) {
    return failure(
      "LEDGER_VALIDATION_FAILED",
      "form",
      validation.errors[0]?.message ?? translateDefault("assetTransfer.validation.ledgerInvalid"),
    );
  }

  return { ok: true, assetTransfer };
}

export function validateAssetTransferRemoval(
  assetTransferId: string,
  ledgerData: LedgerData,
): ValidateAssetTransferRemovalResult {
  if (!ledgerData.assetTransfers.some(({ id }) => id === assetTransferId)) {
    return removalFailure(
      "TRANSFER_NOT_FOUND",
      translateDefault("assetTransfer.validation.notFound"),
    );
  }
  const nextLedger: LedgerData = {
    ...ledgerData,
    assetTransfers: ledgerData.assetTransfers.filter(
      ({ id }) => id !== assetTransferId,
    ),
  };
  try {
    replayPositions(nextLedger.trades, nextLedger.assetTransfers);
  } catch {
    return removalFailure(
      "REMOVAL_BREAKS_TIMELINE",
      translateDefault("assetTransfer.validation.removalBreaksTimeline"),
    );
  }
  const validation = validateLedgerData(nextLedger);
  if (!validation.ok) {
    return removalFailure(
      "LEDGER_VALIDATION_FAILED",
      validation.errors[0]?.message ?? translateDefault("assetTransfer.validation.removalLedgerInvalid"),
    );
  }
  return { ok: true, assetTransferId };
}

function validateCombination({
  category,
  unitPrice,
  networkFee,
  fromLocation,
  toLocation,
}: Readonly<{
  category: AssetTransferCategory;
  unitPrice?: string;
  networkFee?: string;
  fromLocation?: CustodyLocation;
  toLocation?: CustodyLocation;
}>): CreateAssetTransferResult | undefined {
  if (category === "internal") {
    if (fromLocation === undefined) {
      return failure("INVALID_FROM_LOCATION", "fromLocation", translateDefault("assetTransfer.validation.internalFromRequired"));
    }
    if (toLocation === undefined) {
      return failure("INVALID_TO_LOCATION", "toLocation", translateDefault("assetTransfer.validation.internalToRequired"));
    }
    if (fromLocation === toLocation) {
      return failure("INVALID_TO_LOCATION", "toLocation", translateDefault("assetTransfer.validation.locationsMustDiffer"));
    }
    if (unitPrice !== undefined) {
      return failure("INVALID_COMBINATION", "unitPrice", translateDefault("assetTransfer.validation.internalUnitPriceForbidden"));
    }
    return undefined;
  }
  if (category === "external-in" || category === "gain") {
    if (fromLocation !== undefined) {
      return failure("INVALID_COMBINATION", "fromLocation", translateDefault("assetTransfer.validation.categoryFromForbidden"));
    }
    if (toLocation === undefined) {
      return failure("INVALID_TO_LOCATION", "toLocation", translateDefault("assetTransfer.validation.categoryToRequired"));
    }
    if (unitPrice === undefined) {
      return failure("INVALID_UNIT_PRICE", "unitPrice", translateDefault("assetTransfer.validation.categoryUnitPriceRequired"));
    }
    if (networkFee !== undefined) {
      return failure("INVALID_COMBINATION", "networkFee", translateDefault("assetTransfer.validation.categoryNetworkFeeForbidden"));
    }
    return undefined;
  }
  if (fromLocation === undefined) {
    return failure("INVALID_FROM_LOCATION", "fromLocation", translateDefault("assetTransfer.validation.externalOutFromRequired"));
  }
  if (toLocation !== undefined) {
    return failure("INVALID_COMBINATION", "toLocation", translateDefault("assetTransfer.validation.externalOutToForbidden"));
  }
  if (unitPrice !== undefined) {
    return failure("INVALID_COMBINATION", "unitPrice", translateDefault("assetTransfer.validation.externalOutUnitPriceForbidden"));
  }
  return undefined;
}

function readOptionalPositiveDecimal(
  value: unknown,
  field: "unitPrice" | "networkFee",
  label: string,
):
  | { ok: true; value?: string }
  | { ok: false; result: CreateAssetTransferResult } {
  if (value === undefined || value === "") return { ok: true };
  if (
    typeof value !== "string" ||
    !isCanonicalDecimal(value) ||
    !isPositive(value)
  ) {
    return {
      ok: false,
      result: failure(
        field === "unitPrice" ? "INVALID_UNIT_PRICE" : "INVALID_NETWORK_FEE",
        field,
        `${label}${translateDefault("assetTransfer.validation.positiveDecimalSuffix")}`,
      ),
    };
  }
  return { ok: true, value };
}

function readOptionalLocation(
  value: unknown,
): CustodyLocation | "invalid" | undefined {
  if (value === undefined || value === "") return undefined;
  return isCustodyLocation(value) ? value : "invalid";
}

function collectLedgerIds(ledgerData: LedgerData): Set<string> {
  return new Set(
    [
      ...ledgerData.assets,
      ...ledgerData.trades,
      ...ledgerData.cashEvents,
      ...ledgerData.assetTransfers,
      ...ledgerData.priceSnapshots,
      ...ledgerData.feeRules,
    ].map(({ id }) => id),
  );
}

function isCanonicalDecimal(value: string): boolean {
  if (!DECIMAL_PATTERN.test(value)) return false;
  const [integer, fraction = ""] = value.split(".");
  const significantDigits =
    `${integer === "0" ? "" : integer}${fraction}`.replace(/^0+/, "")
      .length || 1;
  return significantDigits <= 40 && fraction.length <= 18;
}

function isAssetTransferCategory(
  value: unknown,
): value is AssetTransferCategory {
  return (
    value === "internal" ||
    value === "external-in" ||
    value === "external-out" ||
    value === "gain"
  );
}

function isAssetTransferReason(value: unknown): value is AssetTransferReason {
  return (
    value === "deposit" ||
    value === "withdrawal" ||
    value === "internal-move" ||
    value === "airdrop" ||
    value === "interest" ||
    value === "platform-gift"
  );
}

function isCustodyLocation(value: unknown): value is CustodyLocation {
  return (
    value === "exchange" ||
    value === "cold-wallet" ||
    value === "cold-wallet-earn"
  );
}

function isTechnicalId(value: string): boolean {
  return value.length > 0 && value.length <= 128 && value.trim() === value;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function failure(
  code: keyof typeof ASSET_TRANSFER_SERVICE_ERROR_CODES,
  field: AssetTransferServiceError["field"],
  message: string,
): AssetTransferFailure {
  return {
    ok: false,
    error: { code: ASSET_TRANSFER_SERVICE_ERROR_CODES[code], field, message },
  };
}

function removalFailure(
  code: keyof typeof ASSET_TRANSFER_SERVICE_ERROR_CODES,
  message: string,
): ValidateAssetTransferRemovalResult {
  const result = failure(code, "form", message);
  return { ok: false, error: result.error };
}
