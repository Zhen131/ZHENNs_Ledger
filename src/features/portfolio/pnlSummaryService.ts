/**
 * 这个文件管一件事：算首页那几个盈亏总数。
 * 它不管每种币的持仓，那在 `positionService.ts`；也不管一笔买卖动多少钱，那在 core 的 `tradeCashImpact`。
 * 不显然的决定：有一笔算不准，那个总数就不给数，只列原因；2026-08-09 定（W12 01A 第 7.4 节）。
 */
import { calculateTradeCashImpact } from "@/core/calculations";
import type {
  DecimalString,
  FeeAccountingIssue,
  LedgerData,
  Trade,
  ValuationPriceMode,
} from "@/core/models";
import {
  isSupportedValuationCurrency,
  partitionLedgerFactsForToday,
} from "@/core/policies";
import { add, getLedgerDateKey, isZero } from "@/core/shared";
import { translateDefault } from "@/ui";
import {
  createValuationDisplay,
  type ValuationDisplay,
} from "./valuationDisplay";
import { getPositionsFromLedger } from "./positionService";
import type { LedgerProjection } from "./ledgerProjection";

/**
 * 一个总数：算得全就有 `value`。
 * 算不全就没有数，只有原因清单。
 */
export type SummaryMetric = {
  value?: DecimalString;
  missingReasons: string[];
};

/**
 * 首页盈亏那一块的全部总数。
 * 有买入总支出、卖出净到账、剩余成本、两种盈亏。
 * 另带每种币的买入总支出、手续费问题和缺价格的币。
 */
export type LedgerPnlSummary = {
  buyOutflow: SummaryMetric;
  buyOutflowByAsset: Record<string, SummaryMetric>;
  sellProceeds: SummaryMetric;
  remainingCostBasis: SummaryMetric;
  realizedPnl: SummaryMetric;
  unrealizedPnl: SummaryMetric;
  feeAccountingIssues: FeeAccountingIssue[];
  missingPriceAssets: string[];
  excludedCurrencyAssets: string[];
  valuation: ValuationDisplay;
};

/**
 * 这个函数回答：到今天为止，花出去、收进来、赚了各多少？
 * 今天以后的记录不算。
 * 举例：买 0.1 BTC 成交 6500 手续费 5，卖 0.04 BTC 成交 2800 手续费 3。
 * 价格 70000 → 答买入总支出 6505，卖出净到账 2797。
 * 剩余成本 3903，已实现 195，浮动盈亏 297。
 * 为什么算不全就不给数：缺项按 0 加会冒充完整；2026-08-09 定（W12 01A 第 7.4 节）。
 * 算不全有三种原因：不用 USDT 计价、手续费用别的币、缺价格。
 * 不会出错。
 */
export function buildLedgerPnlSummary(
  ledgerData: LedgerData,
  options: { todayKey: string; mode: ValuationPriceMode },
): LedgerPnlSummary {
  const partition = partitionLedgerFactsForToday(
    ledgerData,
    options.todayKey,
  );
  let buyOutflow: DecimalString = "0";
  let sellProceeds: DecimalString = "0";
  const buyReasons: string[] = [];
  const buyOutflowByAsset = new Map<string, DecimalString>();
  const buyReasonsByAsset = new Map<string, string[]>();
  const sellReasons: string[] = [];

  for (const trade of partition.activeTrades) {
    const reasons = trade.type === "buy" ? buyReasons : sellReasons;
    const assetReasons =
      trade.type === "buy"
        ? getOrCreateReasons(buyReasonsByAsset, trade.assetSymbol)
        : undefined;
    if (trade.type === "buy" && !buyOutflowByAsset.has(trade.assetSymbol)) {
      buyOutflowByAsset.set(trade.assetSymbol, "0");
    }
    if (!isSupportedValuationCurrency(trade.currency)) {
      const reason = trade.id + translateDefault("portfolio.issue.unsupportedCurrencyMiddle") + trade.currency;
      reasons.push(reason);
      assetReasons?.push(reason);
      continue;
    }
    const cashImpact = calculateTradeCashImpact(trade);
    if (!cashImpact.ok) {
      const reason = trade.id + translateDefault("portfolio.issue.feeConversionMiddle") + trade.feeCurrency + translateDefault("portfolio.issue.feeConversionSuffix") + trade.currency;
      reasons.push(reason);
      assetReasons?.push(reason);
      continue;
    }
    if (trade.type === "buy") {
      buyOutflow = add(buyOutflow, cashImpact.amount);
      buyOutflowByAsset.set(
        trade.assetSymbol,
        add(buyOutflowByAsset.get(trade.assetSymbol) ?? "0", cashImpact.amount),
      );
    } else {
      sellProceeds = add(sellProceeds, cashImpact.amount);
    }
  }

  const positions = getPositionsFromLedger(ledgerData, options);
  let remainingCostBasis: DecimalString = "0";
  let realizedPnl: DecimalString = "0";
  let unrealizedPnl: DecimalString = "0";
  const costReasons: string[] = [];
  const realizedReasons: string[] = [];
  const unrealizedReasons: string[] = [];
  const feeAccountingIssues: FeeAccountingIssue[] = [];
  const missingPriceAssets: string[] = [];
  const excludedCurrencyAssets: string[] = [];

  for (const position of positions) {
    if (!isSupportedValuationCurrency(position.currency)) {
      excludedCurrencyAssets.push(position.assetSymbol);
      const reason = position.assetSymbol + translateDefault("portfolio.issue.unsupportedCurrencyMiddle") + position.currency;
      costReasons.push(reason);
      realizedReasons.push(reason);
      if (!isZero(position.quantity)) {
        unrealizedReasons.push(reason);
      }
      continue;
    }
    if (position.feeAccountingIssues) {
      feeAccountingIssues.push(...position.feeAccountingIssues);
      const reason = position.assetSymbol + translateDefault("portfolio.issue.unconvertibleFee");
      costReasons.push(reason);
      realizedReasons.push(reason);
      if (!isZero(position.quantity)) {
        unrealizedReasons.push(reason);
      }
      continue;
    }

    remainingCostBasis = add(remainingCostBasis, position.costBasis);
    realizedPnl = add(realizedPnl, position.realizedPnl);
    if (isZero(position.quantity)) {
      continue;
    }
    if (position.unrealizedPnl === undefined) {
      missingPriceAssets.push(position.assetSymbol);
      unrealizedReasons.push(position.assetSymbol + translateDefault("portfolio.issue.missingCurrentPrice"));
      continue;
    }
    unrealizedPnl = add(unrealizedPnl, position.unrealizedPnl);
  }

  const valuation = createValuationDisplay([
    ...partition.activeTrades.map((trade) => trade.currency),
    ...positions.map((position) => position.currency),
  ]);

  return {
    buyOutflow: metric(buyOutflow, buyReasons),
    buyOutflowByAsset: Object.fromEntries(
      [...buyOutflowByAsset.keys()].sort().map((assetSymbol) => [
        assetSymbol,
        metric(
          buyOutflowByAsset.get(assetSymbol) ?? "0",
          buyReasonsByAsset.get(assetSymbol) ?? [],
        ),
      ]),
    ),
    sellProceeds: metric(sellProceeds, sellReasons),
    remainingCostBasis: metric(remainingCostBasis, costReasons),
    realizedPnl: metric(realizedPnl, realizedReasons),
    unrealizedPnl: metric(unrealizedPnl, unrealizedReasons),
    feeAccountingIssues,
    missingPriceAssets: uniqueSorted(missingPriceAssets),
    excludedCurrencyAssets: uniqueSorted(excludedCurrencyAssets),
    valuation,
  };
}

/**
 * 这个函数回答：只加了一笔买卖，能不能在上一份总数上补算？
 * 能补就返回新总数。
 * 上一份本来就不全、或这笔算不进来，就返回 `null`。
 * 拿到 `null` 的一方应改用 `buildLedgerPnlSummary` 从头算。
 * 举例：上一份买入总支出 6505，再买一笔成交 1000 手续费 1 → 答 7506。
 * 剩余成本和盈亏不累加，从传进来的新持仓重新加总。
 * 今天以后的买卖不算，原样返回上一份。
 */
export function updateLedgerPnlSummaryForAppendedTrade(
  previous: LedgerPnlSummary,
  trade: Trade,
  projection: LedgerProjection,
  todayKey: string,
): LedgerPnlSummary | null {
  if (getLedgerDateKey(trade.occurredAt) > todayKey) return previous;
  if (
    previous.buyOutflow.value === undefined ||
    previous.sellProceeds.value === undefined ||
    previous.remainingCostBasis.value === undefined ||
    previous.realizedPnl.value === undefined ||
    previous.unrealizedPnl.value === undefined ||
    previous.feeAccountingIssues.length > 0 ||
    previous.missingPriceAssets.length > 0 ||
    previous.excludedCurrencyAssets.length > 0 ||
    !isSupportedValuationCurrency(trade.currency)
  ) {
    return null;
  }
  const cashImpact = calculateTradeCashImpact(trade);
  if (!cashImpact.ok) return null;

  let remainingCostBasis: DecimalString = "0";
  let realizedPnl: DecimalString = "0";
  let unrealizedPnl: DecimalString = "0";
  for (const position of projection.positions) {
    if (
      !isSupportedValuationCurrency(position.currency) ||
      position.feeAccountingIssues
    ) {
      return null;
    }
    remainingCostBasis = add(remainingCostBasis, position.costBasis);
    realizedPnl = add(realizedPnl, position.realizedPnl);
    if (isZero(position.quantity)) continue;
    if (position.unrealizedPnl === undefined) return null;
    unrealizedPnl = add(unrealizedPnl, position.unrealizedPnl);
  }

  const buyOutflowByAsset = { ...previous.buyOutflowByAsset };
  let buyOutflow = previous.buyOutflow.value;
  let sellProceeds = previous.sellProceeds.value;
  if (trade.type === "buy") {
    buyOutflow = add(buyOutflow, cashImpact.amount);
    const priorAsset = buyOutflowByAsset[trade.assetSymbol];
    if (priorAsset?.value === undefined && priorAsset !== undefined) return null;
    buyOutflowByAsset[trade.assetSymbol] = metric(
      add(priorAsset?.value ?? "0", cashImpact.amount),
      [],
    );
  } else {
    sellProceeds = add(sellProceeds, cashImpact.amount);
  }

  return {
    buyOutflow: metric(buyOutflow, []),
    buyOutflowByAsset: Object.fromEntries(
      Object.entries(buyOutflowByAsset).sort(([left], [right]) =>
        left < right ? -1 : left > right ? 1 : 0,
      ),
    ),
    sellProceeds: metric(sellProceeds, []),
    remainingCostBasis: metric(remainingCostBasis, []),
    realizedPnl: metric(realizedPnl, []),
    unrealizedPnl: metric(unrealizedPnl, []),
    feeAccountingIssues: [],
    missingPriceAssets: [],
    excludedCurrencyAssets: [],
    valuation: previous.valuation,
  };
}

function getOrCreateReasons(
  reasonsByAsset: Map<string, string[]>,
  assetSymbol: string,
): string[] {
  const existing = reasonsByAsset.get(assetSymbol);
  if (existing) return existing;
  const reasons: string[] = [];
  reasonsByAsset.set(assetSymbol, reasons);
  return reasons;
}

function metric(value: DecimalString, reasons: string[]): SummaryMetric {
  return reasons.length === 0
    ? { value, missingReasons: [] }
    : { missingReasons: uniqueSorted(reasons) };
}

function uniqueSorted(values: string[]): string[] {
  return Array.from(new Set(values)).sort();
}
