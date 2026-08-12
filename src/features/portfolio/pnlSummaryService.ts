import { calculateTradeCashImpact } from "@/core/calculations";
import type {
  DecimalString,
  FeeAccountingIssue,
  LedgerData,
  ValuationPriceMode,
} from "@/core/models";
import {
  isSupportedValuationCurrency,
  partitionLedgerFactsForToday,
} from "@/core/policies";
import { add, isZero } from "@/core/shared";
import {
  createValuationDisplay,
  type ValuationDisplay,
} from "./valuationDisplay";
import { getPositionsFromLedger } from "./positionService";

export type SummaryMetric = {
  value?: DecimalString;
  missingReasons: string[];
};

export type LedgerPnlSummary = {
  buyOutflow: SummaryMetric;
  sellProceeds: SummaryMetric;
  remainingCostBasis: SummaryMetric;
  realizedPnl: SummaryMetric;
  unrealizedPnl: SummaryMetric;
  feeAccountingIssues: FeeAccountingIssue[];
  missingPriceAssets: string[];
  excludedCurrencyAssets: string[];
  valuation: ValuationDisplay;
};

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
  const sellReasons: string[] = [];

  for (const trade of partition.activeTrades) {
    const reasons = trade.type === "buy" ? buyReasons : sellReasons;
    if (!isSupportedValuationCurrency(trade.currency)) {
      reasons.push(`${trade.id} 使用不支持的计价币种 ${trade.currency}`);
      continue;
    }
    const cashImpact = calculateTradeCashImpact(trade);
    if (!cashImpact.ok) {
      reasons.push(
        `${trade.id} 的 ${trade.feeCurrency} 手续费无法换算为 ${trade.currency}`,
      );
      continue;
    }
    if (trade.type === "buy") {
      buyOutflow = add(buyOutflow, cashImpact.amount);
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
      const reason = `${position.assetSymbol} 使用不支持的计价币种 ${position.currency}`;
      costReasons.push(reason);
      realizedReasons.push(reason);
      if (!isZero(position.quantity)) {
        unrealizedReasons.push(reason);
      }
      continue;
    }
    if (position.feeAccountingIssues) {
      feeAccountingIssues.push(...position.feeAccountingIssues);
      const reason = `${position.assetSymbol} 存在无法换算的手续费`;
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
      unrealizedReasons.push(`${position.assetSymbol} 缺少合法当前价格`);
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

function metric(value: DecimalString, reasons: string[]): SummaryMetric {
  return reasons.length === 0
    ? { value, missingReasons: [] }
    : { missingReasons: uniqueSorted(reasons) };
}

function uniqueSorted(values: string[]): string[] {
  return Array.from(new Set(values)).sort();
}
