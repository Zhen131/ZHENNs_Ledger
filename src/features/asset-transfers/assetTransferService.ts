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
  systemLedgerClock,
} from "@/core/shared";
import {
  isValidISODateOrDateTime,
  validateLedgerData,
} from "@/core/validation";

const MAX_ID_ATTEMPTS = 3;
const DECIMAL_PATTERN = /^(?:0|[1-9]\d*)(?:\.\d+)?$/;

export const ASSET_TRANSFER_REASONS_BY_CATEGORY = {
  internal: ["internal-move"],
  "external-in": ["deposit"],
  "external-out": ["withdrawal"],
  gain: ["airdrop", "interest", "platform-gift"],
} as const satisfies Readonly<
  Record<AssetTransferCategory, readonly AssetTransferReason[]>
>;

export type AssetTransferDraft = Readonly<{
  category: AssetTransferCategory;
  assetSymbol: string;
  reason: AssetTransferReason;
  quantity: string;
  occurredAt: string;
  unitPrice?: string;
  networkFee?: string;
  fromLocation?: CustodyLocation;
  toLocation?: CustodyLocation;
  note?: string;
}>;

export const ASSET_TRANSFER_SERVICE_ERROR_CODES = {
  INVALID_INPUT: "ASSET_TRANSFER_INVALID_INPUT",
  INVALID_CATEGORY: "ASSET_TRANSFER_INVALID_CATEGORY",
  INVALID_ASSET: "ASSET_TRANSFER_INVALID_ASSET",
  INVALID_REASON: "ASSET_TRANSFER_INVALID_REASON",
  INVALID_QUANTITY: "ASSET_TRANSFER_INVALID_QUANTITY",
  INVALID_DATE: "ASSET_TRANSFER_INVALID_DATE",
  FUTURE_FACT: "ASSET_TRANSFER_FUTURE_FACT",
  INVALID_UNIT_PRICE: "ASSET_TRANSFER_INVALID_UNIT_PRICE",
  INVALID_NETWORK_FEE: "ASSET_TRANSFER_INVALID_NETWORK_FEE",
  INVALID_FROM_LOCATION: "ASSET_TRANSFER_INVALID_FROM_LOCATION",
  INVALID_TO_LOCATION: "ASSET_TRANSFER_INVALID_TO_LOCATION",
  INVALID_COMBINATION: "ASSET_TRANSFER_INVALID_COMBINATION",
  INVALID_NOTE: "ASSET_TRANSFER_INVALID_NOTE",
  NOTE_TOO_LONG: "ASSET_TRANSFER_NOTE_TOO_LONG",
  INSUFFICIENT_HOLDING: "ASSET_TRANSFER_INSUFFICIENT_HOLDING",
  TRANSFER_NOT_FOUND: "ASSET_TRANSFER_NOT_FOUND",
  REMOVAL_BREAKS_TIMELINE: "ASSET_TRANSFER_REMOVAL_BREAKS_TIMELINE",
  ID_GENERATION_EXHAUSTED: "ASSET_TRANSFER_ID_GENERATION_EXHAUSTED",
  DEPENDENCY_FAILURE: "ASSET_TRANSFER_DEPENDENCY_FAILURE",
  LEDGER_VALIDATION_FAILED: "ASSET_TRANSFER_LEDGER_VALIDATION_FAILED",
} as const;

export type AssetTransferServiceError = Readonly<{
  code: (typeof ASSET_TRANSFER_SERVICE_ERROR_CODES)[keyof typeof ASSET_TRANSFER_SERVICE_ERROR_CODES];
  field:
    | "form"
    | "category"
    | "assetSymbol"
    | "reason"
    | "quantity"
    | "occurredAt"
    | "unitPrice"
    | "networkFee"
    | "fromLocation"
    | "toLocation"
    | "note";
  message: string;
}>;

export type AssetTransferServiceDependencies = Readonly<{
  generateId: () => string;
  now: () => ISODateTimeString;
  todayKey: () => string;
}>;

export type CreateAssetTransferResult =
  | { ok: true; assetTransfer: AssetTransfer }
  | AssetTransferFailure;

type AssetTransferFailure = {
  ok: false;
  error: AssetTransferServiceError;
};

export type ValidateAssetTransferRemovalResult =
  | { ok: true; assetTransferId: string }
  | { ok: false; error: AssetTransferServiceError };

export function createValidatedAssetTransfer(
  input: unknown,
  ledgerData: LedgerData,
  providedDependencies?: AssetTransferServiceDependencies,
): CreateAssetTransferResult {
  if (!isRecord(input)) {
    return failure("INVALID_INPUT", "form", "资产转入转出必须是对象");
  }
  if (!isAssetTransferCategory(input.category)) {
    return failure("INVALID_CATEGORY", "category", "请选择有效的转移类别");
  }
  const category = input.category;
  if (
    typeof input.assetSymbol !== "string" ||
    !ledgerData.assets.some((asset) => asset.symbol === input.assetSymbol)
  ) {
    return failure("INVALID_ASSET", "assetSymbol", "请选择账本中已存在的资产");
  }
  if (!isAssetTransferReason(input.reason)) {
    return failure("INVALID_REASON", "reason", "请选择有效的原因");
  }
  if (
    !ASSET_TRANSFER_REASONS_BY_CATEGORY[category].some(
      (reason) => reason === input.reason,
    )
  ) {
    return failure("INVALID_REASON", "reason", "原因与转移类别不匹配");
  }
  if (
    typeof input.quantity !== "string" ||
    !isCanonicalDecimal(input.quantity) ||
    !isPositive(input.quantity)
  ) {
    return failure(
      "INVALID_QUANTITY",
      "quantity",
      "数量必须大于 0，且是最多 40 位有效数字、18 位小数的规范十进制",
    );
  }
  if (
    typeof input.occurredAt !== "string" ||
    !isValidISODateOrDateTime(input.occurredAt)
  ) {
    return failure("INVALID_DATE", "occurredAt", "请输入有效日期");
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
    return failure("DEPENDENCY_FAILURE", "form", "无法读取当前账本日期");
  }
  if (input.occurredAt.slice(0, 10) > todayKey) {
    return failure("FUTURE_FACT", "occurredAt", "转移日期不能晚于今天");
  }

  const unitPriceResult = readOptionalPositiveDecimal(
    input.unitPrice,
    "unitPrice",
    "到账单价",
  );
  if (!unitPriceResult.ok) return unitPriceResult.result;
  const networkFeeResult = readOptionalPositiveDecimal(
    input.networkFee,
    "networkFee",
    "链上手续费",
  );
  if (!networkFeeResult.ok) return networkFeeResult.result;
  const fromLocation = readOptionalLocation(input.fromLocation);
  if (fromLocation === "invalid") {
    return failure("INVALID_FROM_LOCATION", "fromLocation", "请选择有效的来源位置");
  }
  const toLocation = readOptionalLocation(input.toLocation);
  if (toLocation === "invalid") {
    return failure("INVALID_TO_LOCATION", "toLocation", "请选择有效的目的位置");
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
    return failure("INVALID_NOTE", "note", "备注必须是文本");
  }
  const note =
    typeof input.note === "string" && input.note.trim() !== ""
      ? input.note.trim()
      : undefined;
  if (note !== undefined && note.length > 4_096) {
    return failure("NOTE_TOO_LONG", "note", "备注不能超过 4096 个字符");
  }

  const existingIds = collectLedgerIds(ledgerData);
  let id: string | undefined;
  for (let attempt = 0; attempt < MAX_ID_ATTEMPTS; attempt += 1) {
    let candidate: string;
    try {
      candidate = dependencies.generateId();
    } catch {
      return failure("DEPENDENCY_FAILURE", "form", "无法生成资产转移 ID");
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
      "连续三次未能生成唯一资产转移 ID",
    );
  }

  let timestamp: ISODateTimeString;
  try {
    timestamp = dependencies.now();
  } catch {
    return failure("DEPENDENCY_FAILURE", "form", "无法读取保存时间");
  }

  const common = {
    id,
    occurredAt: input.occurredAt,
    timePrecision: input.occurredAt.includes("T")
      ? ("second" as const)
      : ("day" as const),
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
      "数量与链上手续费之和不能超过总持仓或来源位置持仓",
    );
  }

  const validation = validateLedgerData(nextLedger);
  if (!validation.ok) {
    return failure(
      "LEDGER_VALIDATION_FAILED",
      "form",
      validation.errors[0]?.message ?? "资产转移未通过账本校验",
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
      "没有找到该资产转移",
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
      "无法删除：该转移支撑了后续交易或转移，请先删除依赖它的后续事实",
    );
  }
  const validation = validateLedgerData(nextLedger);
  if (!validation.ok) {
    return removalFailure(
      "LEDGER_VALIDATION_FAILED",
      validation.errors[0]?.message ?? "删除后的账本未通过校验",
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
      return failure("INVALID_FROM_LOCATION", "fromLocation", "内部转移必须选择来源位置");
    }
    if (toLocation === undefined) {
      return failure("INVALID_TO_LOCATION", "toLocation", "内部转移必须选择目的位置");
    }
    if (fromLocation === toLocation) {
      return failure("INVALID_TO_LOCATION", "toLocation", "目的位置必须与来源位置不同");
    }
    if (unitPrice !== undefined) {
      return failure("INVALID_COMBINATION", "unitPrice", "内部转移不能填写到账单价");
    }
    return undefined;
  }
  if (category === "external-in" || category === "gain") {
    if (fromLocation !== undefined) {
      return failure("INVALID_COMBINATION", "fromLocation", "该类别不能填写来源位置");
    }
    if (toLocation === undefined) {
      return failure("INVALID_TO_LOCATION", "toLocation", "该类别必须选择目的位置");
    }
    if (unitPrice === undefined) {
      return failure("INVALID_UNIT_PRICE", "unitPrice", "该类别必须填写大于 0 的到账单价");
    }
    if (networkFee !== undefined) {
      return failure("INVALID_COMBINATION", "networkFee", "该类别不能填写链上手续费");
    }
    return undefined;
  }
  if (fromLocation === undefined) {
    return failure("INVALID_FROM_LOCATION", "fromLocation", "外部转出必须选择来源位置");
  }
  if (toLocation !== undefined) {
    return failure("INVALID_COMBINATION", "toLocation", "外部转出不能填写目的位置");
  }
  if (unitPrice !== undefined) {
    return failure("INVALID_COMBINATION", "unitPrice", "外部转出不能填写到账单价");
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
        `${label}必须大于 0，且是最多 40 位有效数字、18 位小数的规范十进制`,
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
