/**
 * 这个文件管一件事：检查表单填的现金记录，合格就造出一条。
 * 它不管弹确认框和存盘，那在 `cashEventPanelActions.ts` 和上层的存盘流程。
 * 不显然的决定：校准存下旧余额和差额，不改旧记录；2026-08-19 定（W14 01B 第 3.2 节）。
 */
import type {
  CashEvent,
  CashEventType,
  ISODateTimeString,
  LedgerData,
} from "@/core/models";
import {
  captureLedgerTime,
  isPositive,
  isSupportedTimeZone,
  isTimePrecision,
  subtract,
  systemLedgerClock,
} from "@/core/shared";
import {
  isTechnicalId,
  isValidISODateOrDateTime,
  validateLedgerData,
} from "@/core/validation";
import { translateDefault } from "@/ui";
import {
  projectLedgerCashMutation,
  type CashMutationProjection,
} from "./cashProjection";

/**
 * 为什么最多试 3 次：2026-08-19 定（W14 01B 第 3.5 节）。
 * 撞号 3 次几乎不可能，再撞就当出错。
 */
const MAX_ID_ATTEMPTS = 3;
const DECIMAL_PATTERN = /^-?(?:0|[1-9]\d*)(?:\.\d+)?$/;

/**
 * 新建现金记录可能失败的原因，一种一个代码。
 * 界面按代码分支，不去读说明文字。
 */
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

type CashEventServiceError = Readonly<{
  code: (typeof CASH_EVENT_SERVICE_ERROR_CODES)[keyof typeof CASH_EVENT_SERVICE_ERROR_CODES];
  field: "form" | "type" | "occurredAt" | "amountOrTarget" | "note";
  message: string;
}>;

/**
 * 新建时要用的三样外部东西：生成编号、读时刻、读今天。
 * 测试时可以换成固定的。
 */
export type CashEventServiceDependencies = Readonly<{
  generateId: () => string;
  now: () => ISODateTimeString;
  todayKey: () => string;
}>;

type CreateCashEventResult =
  | {
      ok: true;
      cashEvent: CashEvent;
      projection: CashMutationProjection;
    }
  | { ok: false; error: CashEventServiceError };

/**
 * 这个函数回答：表单填的这条现金记录合不合规矩？合规就造出一条。
 * 四种类型：入金、出金、外部支出、余额校准。
 * 前三种的金额必须大于 0；校准填的是目标余额，可以是 0 或负数。
 * 举例：现在余额 100，校准到 80 → 造出一条差额 -20 的校准。
 * 同时算好改完后的余额，供界面判断要不要再确认。
 * 什么时候出错：不返回抛错，返回 `ok:false` 和错误代码。
 * 比如日期在今天以后、金额写法不对、备注太长。
 * 界面拿到后把说明文字显示在对应的输入框旁。
 */
export function createValidatedCashEvent(
  input: unknown,
  ledgerData: LedgerData,
  providedDependencies?: CashEventServiceDependencies,
): CreateCashEventResult {
  if (!isRecord(input)) {
    return failure("INVALID_INPUT", "form", translateDefault("cash.validation.invalidInput"));
  }
  if (!isCashEventType(input.type)) {
    return failure("INVALID_TYPE", "type", translateDefault("cash.validation.invalidType"));
  }
  if (
    typeof input.occurredAt !== "string" ||
    !isValidISODateOrDateTime(input.occurredAt)
  ) {
    return failure("INVALID_DATE", "occurredAt", translateDefault("cash.validation.invalidDate"));
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
      translateDefault("cash.validation.readTodayFailed"),
    );
  }
  if (input.occurredAt.slice(0, 10) > todayKey) {
    return failure("FUTURE_FACT", "occurredAt", translateDefault("cash.validation.futureFact"));
  }
  const occurredTimeZone = input.occurredTimeZone;
  if (
    occurredTimeZone !== undefined &&
    (typeof occurredTimeZone !== "string" ||
      !isSupportedTimeZone(occurredTimeZone))
  ) {
    return failure("INVALID_DATE", "occurredAt", translateDefault("cash.validation.invalidTimeZone"));
  }
  const timePrecision = input.timePrecision;
  if (timePrecision !== undefined && !isTimePrecision(timePrecision)) {
    return failure("INVALID_DATE", "occurredAt", translateDefault("cash.validation.invalidTimePrecision"));
  }

  if (
    typeof input.amountOrTarget !== "string" ||
    !isCanonicalDecimal(input.amountOrTarget)
  ) {
    return failure(
      "INVALID_AMOUNT",
      "amountOrTarget",
      translateDefault("cash.validation.invalidDecimal"),
    );
  }
  if (
    input.type !== "balance-adjustment" &&
    !isPositive(input.amountOrTarget)
  ) {
    return failure(
      "INVALID_AMOUNT",
      "amountOrTarget",
      translateDefault("cash.validation.positiveAmount"),
    );
  }
  const note =
    typeof input.note === "string" && input.note.trim() !== ""
      ? input.note.trim()
      : undefined;
  if (note !== undefined && note.length > 4_096) {
    return failure("NOTE_TOO_LONG", "note", translateDefault("cash.validation.noteTooLong"));
  }

  const existingIds = collectLedgerIds(ledgerData);
  let id: string | undefined;
  for (let attempt = 0; attempt < MAX_ID_ATTEMPTS; attempt += 1) {
    let candidate: string;
    try {
      candidate = dependencies.generateId();
    } catch {
      return failure("DEPENDENCY_FAILURE", "form", translateDefault("cash.validation.generateIdFailed"));
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
      translateDefault("cash.validation.generateIdExhausted"),
    );
  }

  let timestamp: ISODateTimeString;
  try {
    timestamp = dependencies.now();
  } catch {
    return failure("DEPENDENCY_FAILURE", "form", translateDefault("cash.validation.readSaveTimeFailed"));
  }

  const currentBalance = projectLedgerCashMutation(
    ledgerData,
    ledgerData,
    todayKey,
  ).currentBalance;
  const common = {
    id,
    occurredAt: input.occurredAt,
    ...(occurredTimeZone === undefined ? {} : { occurredTimeZone }),
    timePrecision:
      timePrecision ??
      (input.occurredAt.includes("T")
        ? ("second" as const)
        : ("day" as const)),
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
      validation.errors[0]?.message ?? translateDefault("cash.validation.ledgerInvalid"),
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
      ...ledgerData.assetTransfers,
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
