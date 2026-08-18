import type {
  CashEvent,
  CashEventType,
  ISODateTimeString,
  LedgerData,
} from "@/core/models";
import {
  captureLedgerTime,
  isPositive,
  subtract,
  systemLedgerClock,
} from "@/core/shared";
import {
  isValidISODateOrDateTime,
  validateLedgerData,
} from "@/core/validation";
import {
  projectLedgerCashMutation,
  type CashMutationProjection,
} from "./cashProjection";

const MAX_ID_ATTEMPTS = 3;
const DECIMAL_PATTERN = /^-?(?:0|[1-9]\d*)(?:\.\d+)?$/;

export type CashEventDraft = Readonly<{
  type: CashEventType;
  occurredAt: string;
  amountOrTarget: string;
  note?: string;
}>;

export const CASH_EVENT_SERVICE_ERROR_CODES = {
  INVALID_INPUT: "CASH_EVENT_INVALID_INPUT",
  INVALID_TYPE: "CASH_EVENT_INVALID_TYPE",
  INVALID_DATE: "CASH_EVENT_INVALID_DATE",
  FUTURE_FACT: "CASH_EVENT_FUTURE_FACT",
  INVALID_AMOUNT: "CASH_EVENT_INVALID_AMOUNT",
  NOTE_TOO_LONG: "CASH_EVENT_NOTE_TOO_LONG",
  ID_GENERATION_EXHAUSTED: "CASH_EVENT_ID_GENERATION_EXHAUSTED",
  DEPENDENCY_FAILURE: "CASH_EVENT_DEPENDENCY_FAILURE",
  LEDGER_VALIDATION_FAILED: "CASH_EVENT_LEDGER_VALIDATION_FAILED",
} as const;

export type CashEventServiceError = Readonly<{
  code: (typeof CASH_EVENT_SERVICE_ERROR_CODES)[keyof typeof CASH_EVENT_SERVICE_ERROR_CODES];
  field: "form" | "type" | "occurredAt" | "amountOrTarget" | "note";
  message: string;
}>;

export type CashEventServiceDependencies = Readonly<{
  generateId: () => string;
  now: () => ISODateTimeString;
  todayKey: () => string;
}>;

export type CreateCashEventResult =
  | {
      ok: true;
      cashEvent: CashEvent;
      projection: CashMutationProjection;
    }
  | { ok: false; error: CashEventServiceError };

export function createValidatedCashEvent(
  input: unknown,
  ledgerData: LedgerData,
  providedDependencies?: CashEventServiceDependencies,
): CreateCashEventResult {
  if (!isRecord(input)) {
    return failure("INVALID_INPUT", "form", "现金事实必须是对象");
  }
  if (!isCashEventType(input.type)) {
    return failure("INVALID_TYPE", "type", "请选择有效的现金类型");
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
    return failure(
      "DEPENDENCY_FAILURE",
      "form",
      "无法读取当前账本日期",
    );
  }
  if (input.occurredAt.slice(0, 10) > todayKey) {
    return failure("FUTURE_FACT", "occurredAt", "现金日期不能晚于今天");
  }
  if (
    typeof input.amountOrTarget !== "string" ||
    !isCanonicalDecimal(input.amountOrTarget)
  ) {
    return failure(
      "INVALID_AMOUNT",
      "amountOrTarget",
      "金额必须是最多 40 位有效数字、18 位小数的规范十进制",
    );
  }
  if (
    input.type !== "balance-adjustment" &&
    !isPositive(input.amountOrTarget)
  ) {
    return failure(
      "INVALID_AMOUNT",
      "amountOrTarget",
      "入金、出金和外部支出金额必须大于 0",
    );
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
      return failure("DEPENDENCY_FAILURE", "form", "无法生成现金事实 ID");
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
      "连续三次未能生成唯一现金事实 ID",
    );
  }

  let timestamp: ISODateTimeString;
  try {
    timestamp = dependencies.now();
  } catch {
    return failure("DEPENDENCY_FAILURE", "form", "无法读取保存时间");
  }

  const currentBalance = projectLedgerCashMutation(
    ledgerData,
    ledgerData,
    todayKey,
  ).currentBalance;
  const common = {
    id,
    occurredAt: input.occurredAt,
    timePrecision: input.occurredAt.includes("T")
      ? ("second" as const)
      : ("day" as const),
    currency: "USDT" as const,
    ...(note === undefined ? {} : { note }),
    createdAt: timestamp,
    updatedAt: timestamp,
  };
  const cashEvent: CashEvent =
    input.type === "balance-adjustment"
      ? {
          ...common,
          type: "balance-adjustment",
          balanceBefore: currentBalance,
          targetBalance: input.amountOrTarget,
          adjustmentAmount: subtract(input.amountOrTarget, currentBalance),
        }
      : {
          ...common,
          type: input.type,
          amount: input.amountOrTarget,
        };
  const nextLedger = {
    ...ledgerData,
    cashEvents: [...ledgerData.cashEvents, cashEvent],
  };
  const validation = validateLedgerData(nextLedger);
  if (!validation.ok) {
    return failure(
      "LEDGER_VALIDATION_FAILED",
      "form",
      validation.errors[0]?.message ?? "现金事实未通过账本校验",
    );
  }

  return {
    ok: true,
    cashEvent,
    projection: projectLedgerCashMutation(
      ledgerData,
      validation.value,
      todayKey,
    ),
  };
}

function collectLedgerIds(ledgerData: LedgerData): Set<string> {
  return new Set(
    [
      ...ledgerData.assets,
      ...ledgerData.trades,
      ...ledgerData.cashEvents,
      ...ledgerData.priceSnapshots,
      ...ledgerData.feeRules,
    ].map(({ id }) => id),
  );
}

function isCanonicalDecimal(value: string): boolean {
  if (!DECIMAL_PATTERN.test(value) || /^-0(?:\.0+)?$/.test(value)) {
    return false;
  }
  const unsigned = value.startsWith("-") ? value.slice(1) : value;
  const [integer, fraction = ""] = unsigned.split(".");
  const significantDigits =
    `${integer === "0" ? "" : integer}${fraction}`.replace(/^0+/, "")
      .length || 1;
  return significantDigits <= 40 && fraction.length <= 18;
}

function isCashEventType(value: unknown): value is CashEventType {
  return (
    value === "deposit" ||
    value === "withdrawal" ||
    value === "external-expense" ||
    value === "balance-adjustment"
  );
}

function isTechnicalId(value: string): boolean {
  return value.length > 0 && value.length <= 128 && value.trim() === value;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function failure(
  code: keyof typeof CASH_EVENT_SERVICE_ERROR_CODES,
  field: CashEventServiceError["field"],
  message: string,
): CreateCashEventResult {
  return {
    ok: false,
    error: { code: CASH_EVENT_SERVICE_ERROR_CODES[code], field, message },
  };
}
