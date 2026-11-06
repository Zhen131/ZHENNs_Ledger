/**
 * 这个文件管一件事：检查一笔币的转账能不能记、能不能删。
 * 转账怎么改持仓在 core 的 `positionReplay`，表单画面在 `AssetTransferPanel.tsx`。
 * 不显然的决定：转入和白得的必须填单价，用来算成本；为什么，这是猜的，要核。
 */
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
  isTechnicalId,
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

/** 为什么最多试 3 次：2026-08-19 定（W14 01B 第 3.5 节）。 */
const MAX_ID_ATTEMPTS = 3;
const DECIMAL_PATTERN = /^(?:0|[1-9]\d*)(?:\.\d+)?$/;

type CreateAssetTransferResult =
  | { ok: true; assetTransfer: AssetTransfer }
  | AssetTransferFailure;

type AssetTransferFailure = {
  ok: false;
  error: AssetTransferServiceError;
};

/**
 * 这个函数回答：表单填的这笔转账合不合规矩？合规就造出一笔。
 * 四种分类各有规矩。
 * 内部挪动：要填从哪到哪，两处不能一样，不许填单价。
 * 外部转入和白得：只填到哪，必须填单价，不许填网络费。
 * 外部转出：只填从哪，不许填单价。
 * 举例：交易所转 0.05 BTC 到冷钱包，网络费 0.0001 → 答合规。
 * 举例：手里 0.01 BTC，转出 0.05 → 答不合规，说持仓不够。
 * 什么时候出错：不抛错，返回 `ok:false` 和错误代码，挂在对应的栏上。
 */
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

/**
 * 这个函数回答：这笔转账能不能删？
 * 把它拿掉后，从第一笔到最后一笔按顺序过一遍买卖和转账。
 * 举例：先转入 0.1 BTC，后来卖了 0.1 BTC。
 * 想删那笔转入 → 答不能删，后面的卖出就卖空了。
 * 什么时候出错：不抛错，返回 `ok:false` 和原因。
 */
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
