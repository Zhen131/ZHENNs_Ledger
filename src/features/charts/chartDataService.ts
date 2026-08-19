import type {
  DecimalString,
  LedgerData,
  ValuationPriceMode,
} from "@/core/models";
import {
  isSupportedValuationCurrency,
  partitionLedgerFactsForToday,
} from "@/core/policies";
import {
  add,
  divide,
  isGreaterThan,
  isNegative,
  isZero,
  toDecimalString,
} from "@/core/shared";
import {
  addLedgerDays,
  enumerateLedgerDays,
  getLedgerDateKey,
} from "@/core/shared";
import {
  buildLedgerProjection,
  createValuationDisplay,
  type LedgerProjection,
  type ValuationDisplay,
} from "@/features/portfolio";

export type HoldingAllocationSlice = {
  assetSymbol: string;
  marketValue: DecimalString;
  ratio: DecimalString;
  source: "manual" | "binance" | "cash";
  asOf: string;
};

export type HoldingAllocation = {
  slices: HoldingAllocationSlice[];
  assetMarketValue: DecimalString;
  cashBalance: DecimalString;
  cashDeficit: DecimalString;
  totalMarketValue: DecimalString;
  missingPriceAssets: string[];
  excludedCurrencyAssets: string[];
  valuation: ValuationDisplay;
};

export type ChartRange = "1d" | "7d" | "30d" | "365d" | "all";

export type HoldingHistoryPoint = {
  date: string;
  totalCostBasis?: DecimalString;
  totalMarketValue?: DecimalString;
  assetMarketValue: DecimalString;
  cashBalance: DecimalString;
  cashDeficit: DecimalString;
  missingPriceAssets: string[];
  excludedCurrencyAssets: string[];
  unreliableFeeAssets: string[];
  priceAsOfByAsset: Record<string, string>;
  valuation: ValuationDisplay;
  displayBoundary?: "start" | "end";
};

export type TradeHeatmapDay = {
  date: string;
  total: number;
  buys: number;
  sells: number;
  level: 0 | 1 | 2 | 3 | 4;
  activityGroups: TradeHeatmapActivityGroup[];
};

export type TradeHeatmapActivityGroup = {
  assetSymbol: string;
  type: "buy" | "sell";
  count: number;
};

export function buildHoldingAllocation(
  ledgerData: LedgerData,
  options: {
    todayKey: string;
    mode: ValuationPriceMode;
    projection?: LedgerProjection;
  },
): HoldingAllocation {
  const projection =
    options.projection ??
    buildLedgerProjection(ledgerData, {
      asOf: options.todayKey,
      mode: options.mode,
    });
  const valued: Array<{
    assetSymbol: string;
    marketValue: DecimalString;
    source: "manual" | "binance" | "cash";
    asOf: string;
  }> = [];
  for (const position of projection.positions) {
    if (isZero(position.quantity) || position.marketValue === undefined) continue;
    const selected =
      projection.valuation.selectedPricesByAsset[position.assetSymbol];
    if (!selected) continue;
    valued.push({
      assetSymbol: position.assetSymbol,
      marketValue: position.marketValue,
      source: selected.source,
      asOf: selected.asOf,
    });
  }

  const cashBalance = projection.cash.balance;
  const geometryTotal = isNegative(cashBalance)
    ? projection.valuation.pricedAssetMarketValue
    : add(projection.valuation.pricedAssetMarketValue, cashBalance);
  if (!isNegative(cashBalance) && !isZero(cashBalance)) {
    valued.push({
      assetSymbol: "现金 USDT",
      marketValue: cashBalance,
      source: "cash",
      asOf: options.todayKey,
    });
  }

  const slices = isZero(geometryTotal)
    ? []
    : valued
        .map((item) => ({
          ...item,
          ratio: toDecimalString(divide(item.marketValue, geometryTotal)),
        }))
        .sort((left, right) => {
          if (isGreaterThan(left.marketValue, right.marketValue)) {
            return -1;
          }
          if (isGreaterThan(right.marketValue, left.marketValue)) {
            return 1;
          }
          return left.assetSymbol.localeCompare(right.assetSymbol);
        });

  return {
    slices,
    assetMarketValue: projection.valuation.pricedAssetMarketValue,
    cashBalance,
    cashDeficit: projection.cash.deficit,
    totalMarketValue: projection.valuation.totalAssetValue,
    missingPriceAssets: [...projection.valuation.missingPriceAssets],
    excludedCurrencyAssets: [
      ...projection.valuation.excludedCurrencyAssets,
    ],
    valuation: createValuationDisplay(
      ["USDT"],
      getDefaultValuationCurrency(ledgerData),
    ),
  };
}

export function buildHoldingHistory(
  ledgerData: LedgerData,
  options: {
    todayKey: string;
    mode: ValuationPriceMode;
    range: ChartRange;
  },
): HoldingHistoryPoint[] {
  const startDate = getHistoryStartDate(
    [
      ...ledgerData.trades.map((trade) => trade.occurredAt),
      ...ledgerData.cashEvents.map((cashEvent) => cashEvent.occurredAt),
    ],
    options.todayKey,
    options.range,
  );
  const dates = enumerateLedgerDays(startDate, options.todayKey);
  const defaultValuationCurrency = getDefaultValuationCurrency(ledgerData);
  const points = dates.map((date) =>
    createHistoryPoint(
      date,
      buildLedgerProjection(ledgerData, {
        asOf: date,
        mode: options.mode,
      }),
      defaultValuationCurrency,
    ),
  );

  if (options.range !== "1d") {
    return points;
  }

  const point =
    points[0] ??
    createEmptyHistoryPoint(options.todayKey, defaultValuationCurrency);
  return [
    {
      ...point,
      date: `${options.todayKey}T00:00:00`,
      displayBoundary: "start",
    },
    {
      ...point,
      date: `${options.todayKey}T23:59:59`,
      displayBoundary: "end",
    },
  ];
}

export function buildTradeHeatmap(
  ledgerData: LedgerData,
  todayKey: string,
): TradeHeatmapDay[] {
  const startDate = addLedgerDays(todayKey, -364);
  const counts = new Map<
    string,
    {
      total: number;
      buys: number;
      sells: number;
      activityGroups: Map<string, TradeHeatmapActivityGroup>;
    }
  >();
  const partition = partitionLedgerFactsForToday(ledgerData, todayKey);

  for (const trade of partition.activeTrades) {
    const date = getLedgerDateKey(trade.occurredAt);
    if (date < startDate || date > todayKey) {
      continue;
    }
    const current = counts.get(date) ?? {
      total: 0,
      buys: 0,
      sells: 0,
      activityGroups: new Map<string, TradeHeatmapActivityGroup>(),
    };
    current.total += 1;
    if (trade.type === "buy") {
      current.buys += 1;
    } else {
      current.sells += 1;
    }
    const activityKey = `${trade.assetSymbol}\u0000${trade.type}`;
    const activityGroup = current.activityGroups.get(activityKey);
    if (activityGroup) {
      activityGroup.count += 1;
    } else {
      current.activityGroups.set(activityKey, {
        assetSymbol: trade.assetSymbol,
        type: trade.type,
        count: 1,
      });
    }
    counts.set(date, current);
  }

  const maxCount = Math.max(
    0,
    ...Array.from(counts.values()).map((item) => item.total),
  );
  return enumerateLedgerDays(startDate, todayKey).map((date) => {
    const count = counts.get(date);
    const total = count?.total ?? 0;
    return {
      date,
      total,
      buys: count?.buys ?? 0,
      sells: count?.sells ?? 0,
      level: getHeatLevel(total, maxCount),
      activityGroups: Array.from(count?.activityGroups.values() ?? []).sort(
        compareHeatmapActivityGroups,
      ),
    };
  });
}

function compareHeatmapActivityGroups(
  left: TradeHeatmapActivityGroup,
  right: TradeHeatmapActivityGroup,
): number {
  if (left.count !== right.count) {
    return right.count - left.count;
  }
  const assetOrder = left.assetSymbol.localeCompare(right.assetSymbol);
  if (assetOrder !== 0) {
    return assetOrder;
  }
  if (left.type === right.type) {
    return 0;
  }
  return left.type === "buy" ? -1 : 1;
}

function createHistoryPoint(
  date: string,
  projection: LedgerProjection,
  defaultValuationCurrency: "USD" | "USDT",
): HoldingHistoryPoint {
  let totalCostBasis: DecimalString = "0";
  let totalMarketValue: DecimalString = "0";
  const missingPriceAssets: string[] = [];
  const excludedCurrencyAssets: string[] = [];
  const unreliableFeeAssets: string[] = [];
  const priceAsOfByAsset: Record<string, string> = {};
  const valuationCurrencies: string[] = [];

  for (const position of projection.positions) {
    if (!isSupportedValuationCurrency(position.currency)) {
      excludedCurrencyAssets.push(position.assetSymbol);
      continue;
    }

    valuationCurrencies.push(position.currency);
    const feeAccountingReliable = !position.feeAccountingIssues;
    if (!feeAccountingReliable) {
      unreliableFeeAssets.push(position.assetSymbol);
    }
    if (isZero(position.quantity)) {
      continue;
    }

    if (feeAccountingReliable) {
      totalCostBasis = add(totalCostBasis, position.costBasis);
    }
    const selected =
      projection.valuation.selectedPricesByAsset[position.assetSymbol];
    if (!selected || position.marketValue === undefined) {
      missingPriceAssets.push(position.assetSymbol);
      continue;
    }

    totalMarketValue = add(totalMarketValue, position.marketValue);
    priceAsOfByAsset[position.assetSymbol] = selected.asOf;
  }

  const cashBalance = projection.cash.balance;
  return {
    date,
    ...(unreliableFeeAssets.length === 0 ? { totalCostBasis } : {}),
    ...(missingPriceAssets.length === 0
      ? { totalMarketValue: add(totalMarketValue, cashBalance) }
      : {}),
    assetMarketValue: totalMarketValue,
    cashBalance,
    cashDeficit: projection.cash.deficit,
    missingPriceAssets: missingPriceAssets.sort(),
    excludedCurrencyAssets: excludedCurrencyAssets.sort(),
    unreliableFeeAssets: unreliableFeeAssets.sort(),
    priceAsOfByAsset,
    valuation: createValuationDisplay(
      valuationCurrencies,
      defaultValuationCurrency,
    ),
  };
}

function createEmptyHistoryPoint(
  date: string,
  defaultValuationCurrency: "USD" | "USDT",
): HoldingHistoryPoint {
  return {
    date,
    totalCostBasis: "0",
    totalMarketValue: "0",
    assetMarketValue: "0",
    cashBalance: "0",
    cashDeficit: "0",
    missingPriceAssets: [],
    excludedCurrencyAssets: [],
    unreliableFeeAssets: [],
    priceAsOfByAsset: {},
    valuation: createValuationDisplay([], defaultValuationCurrency),
  };
}

function getDefaultValuationCurrency(
  ledgerData: LedgerData,
): "USD" | "USDT" {
  return ledgerData.assets.some((asset) => asset.quoteCurrency === "USDT")
    ? "USDT"
    : "USD";
}

function getHistoryStartDate(
  occurredAtValues: readonly string[],
  todayKey: string,
  range: ChartRange,
): string {
  if (range === "all") {
    return occurredAtValues.length > 0
      ? occurredAtValues
          .map(getLedgerDateKey)
          .sort((left, right) => left.localeCompare(right))[0]
      : todayKey;
  }
  const days = range === "1d" ? 1 : Number.parseInt(range, 10);
  return addLedgerDays(todayKey, -(days - 1));
}

function getHeatLevel(
  count: number,
  maxCount: number,
): 0 | 1 | 2 | 3 | 4 {
  if (count === 0 || maxCount === 0) {
    return 0;
  }
  if (count * 4 <= maxCount) {
    return 1;
  }
  if (count * 2 <= maxCount) {
    return 2;
  }
  if (count * 4 <= maxCount * 3) {
    return 3;
  }
  return 4;
}
