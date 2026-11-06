/**
 * 这个文件管一件事：检查表单填的买卖，合格就造出一笔交易。
 * 每栏怎么检查交给 core 的 `validateTradeDraft`。
 * 这里补上编号、时间和持仓检查。
 * 不显然的决定：新交易只许用 USDT，手续费也要同币种；2026-08-09 定（W12 01A 第 6.1 节）。
 */
import type {
  ISODateTimeString,
  LedgerData,
  Trade,
  TradeDraft,
} from "@/core/models";
import { replayPositions } from "@/core/calculations";
import {
  TRADE_VALIDATION_ERROR_CODES,
  isTechnicalId,
  type TradeValidationError,
  validateTradeDraft,
} from "@/core/validation";
import {
  captureLedgerTime,
  isZero,
  systemLedgerClock,
} from "@/core/shared";

/** 为什么最多试 3 次：2026-08-19 定（W14 01B 第 3.5 节）。 */
const MAX_TRADE_ID_GENERATION_ATTEMPTS = 3;

/** 新建交易时另外两种失败：编号造不出来，或读时刻出错。 */
export const TRADE_SERVICE_ERROR_CODES = {
  ID_GENERATION_EXHAUSTED: "TRADE_ID_GENERATION_EXHAUSTED",
  DEPENDENCY_FAILURE: "TRADE_DEPENDENCY_FAILURE",
} as const;

/**
 * 新建交易要用的外部东西：生成编号、读时刻、读今天。
 * 测试时可以换成固定的。
 */
export type TradeServiceDependencies = {
  generateId: () => string;
  now: () => ISODateTimeString;
  todayKey?: () => string;
};

type TradeServiceOperationalError =
  | {
      code: "TRADE_ID_GENERATION_EXHAUSTED";
      message: string;
    }
  | {
      code: "TRADE_DEPENDENCY_FAILURE";
      operation: "generateId" | "now";
      message: string;
    };

type CreateTradeResult =
  | {
      ok: true;
      trade: Trade;
    }
  | {
      ok: false;
      kind: "validation";
      errors: TradeValidationError[];
    }
  | {
      ok: false;
      kind: "service";
      error: TradeServiceOperationalError;
    };

/**
 * 这个函数回答：表单填的这笔买卖合不合规矩？合规就造出一笔。
 * 合规的意思：各栏写法对，不在今天以后，用 USDT。
 * 还有卖的不比手里多。
 * 举例：手里 0.1 BTC，填卖出 0.2 BTC → 答不合规，说持仓不够。
 * 手续费是 0 时，手续费币种一律记成 USDT。
 * 为什么：2026-08-19 定（W14 01B 第 3.3 节）。
 * 没填原始文字时，自动拼一段「Structured ledger entry」存进去。
 * 什么时候出错：不抛错，返回 `ok:false`。
 * `kind` 为 `validation` 是填错了，为 `service` 是编号或时刻出错。
 */
export function createValidatedTrade(
  input: unknown,
  ledgerData: LedgerData,
  providedDependencies?: TradeServiceDependencies,
): CreateTradeResult {
  const defaultTimeSnapshot = providedDependencies
    ? undefined
    : captureLedgerTime(systemLedgerClock);
  const dependencies: TradeServiceDependencies = providedDependencies ?? {
    generateId: () => globalThis.crypto.randomUUID(),
    now: () => defaultTimeSnapshot!.now.toISOString(),
    todayKey: () => defaultTimeSnapshot!.todayKey,
  };
  const validationResult = validateTradeDraft(input, {
    assets: ledgerData.assets,
    priorTrades: ledgerData.trades,
    priorAssetTransfers: ledgerData.assetTransfers,
    todayKey:
      dependencies.todayKey?.() ??
      captureLedgerTime(systemLedgerClock).todayKey,
    requireSupportedValuationCurrency: true,
    requiredCurrency: "USDT",
    requireFeeCurrencyMatch: true,
  });

  if (!validationResult.ok) {
    return {
      ok: false,
      kind: "validation",
      errors: validationResult.errors,
    };
  }

  const existingIds = new Set(
    [
      ...ledgerData.assets,
      ...ledgerData.trades,
      ...ledgerData.cashEvents,
      ...ledgerData.assetTransfers,
      ...ledgerData.priceSnapshots,
      ...ledgerData.feeRules,
    ].map(({ id }) => id),
  );
  let id: string | undefined;

  for (
    let attempt = 0;
    attempt < MAX_TRADE_ID_GENERATION_ATTEMPTS;
    attempt += 1
  ) {
    let candidateId: string;

    try {
      candidateId = dependencies.generateId();
    } catch {
      return dependencyFailure("generateId");
    }

    if (isTechnicalId(candidateId) && !existingIds.has(candidateId)) {
      id = candidateId;
      break;
    }
  }

  if (id === undefined) {
    return {
      ok: false,
      kind: "service",
      error: {
        code: TRADE_SERVICE_ERROR_CODES.ID_GENERATION_EXHAUSTED,
        message: "Could not generate a unique trade ID after 3 attempts",
      },
    };
  }

  let timestamp: ISODateTimeString;

  try {
    timestamp = dependencies.now();
  } catch {
    return dependencyFailure("now");
  }

  const persistedDraft = {
    ...validationResult.value,
    feeCurrency: isZero(validationResult.value.fee)
      ? "USDT"
      : (validationResult.value.feeCurrency ?? "USDT"),
  };
  const rawText =
    persistedDraft.rawText === undefined ||
    persistedDraft.rawText.trim() === ""
      ? createStructuredTradeRawText(persistedDraft)
      : persistedDraft.rawText;

  const trade: Trade = {
    ...persistedDraft,
    id,
    rawText,
    createdAt: timestamp,
    updatedAt: timestamp,
  };

  try {
    replayPositions(
      [...ledgerData.trades, trade],
      ledgerData.assetTransfers,
    );
  } catch (error) {
    return {
      ok: false,
      kind: "validation",
      errors: [
        {
          code: TRADE_VALIDATION_ERROR_CODES.INSUFFICIENT_HOLDINGS,
          field: "quantity",
          message:
            error instanceof Error
              ? error.message
              : "Adding this trade would invalidate the holdings timeline",
        },
      ],
    };
  }

  return { ok: true, trade };
}

function createStructuredTradeRawText(
  trade: Readonly<TradeDraft>,
): string {
  return `Structured ledger entry: ${JSON.stringify({
    occurredAt: trade.occurredAt,
    ...(trade.occurredTimeZone === undefined
      ? {}
      : { occurredTimeZone: trade.occurredTimeZone }),
    timePrecision: trade.timePrecision,
    type: trade.type,
    assetSymbol: trade.assetSymbol,
    quantity: trade.quantity,
    price: trade.price,
    totalValue: trade.totalValue,
    currency: trade.currency,
    fee: trade.fee ?? "0",
    feeCurrency: trade.feeCurrency ?? trade.currency,
    ...(trade.platform === undefined ? {} : { platform: trade.platform }),
    ...(trade.feeRuleId === undefined
      ? {}
      : { feeRuleId: trade.feeRuleId }),
    ...(trade.note === undefined ? {} : { note: trade.note }),
  })}`;
}

function dependencyFailure(
  operation: "generateId" | "now",
): CreateTradeResult {
  return {
    ok: false,
    kind: "service",
    error: {
      code: TRADE_SERVICE_ERROR_CODES.DEPENDENCY_FAILURE,
      operation,
      message: `Trade dependency failed during ${operation}`,
    },
  };
}
