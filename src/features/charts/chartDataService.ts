import {
  applyTradeToReplay,
  createPositionReplayState,
  getReplayPositions,
  sortTradesForReplay,
} from "@/core/calculations";
import type {
  Asset,
  DecimalString,
  LedgerData,
  PriceSnapshot,
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
  isZero,
  multiply,
  toDecimalString,
} from "@/core/shared";
import {
  addLedgerDays,
  compareLedgerFactOrder,
  enumerateLedgerDays,
  getLedgerDateKey,
} from "@/core/shared";
import {
  considerPriceSnapshot,
  createPriceSelectionAccumulator,
  getSelectedPrice,
  type PriceSelectionAccumulator,
} from "@/features/portfolio";
import { getValuedPositionsFromLedger } from "@/features/portfolio";
import {
  createValuationDisplay,
  type ValuationDisplay,
} from "@/features/portfolio";

export type HoldingAllocationSlice = {
  assetSymbol: string;
  marketValue: DecimalString;
  ratio: DecimalString;
  source: "manual" | "binance";
  asOf: string;
};

export type HoldingAllocation = {
  slices: HoldingAllocationSlice[];
  totalMarketValue?: DecimalString;
  missingPriceAssets: string[];
  excludedCurrencyAssets: string[];
  valuation: ValuationDisplay;
};

export type ChartRange = "1d" | "7d" | "30d" | "365d" | "all";

export type HoldingHistoryPoint = {
  date: string;
  totalCostBasis?: DecimalString;
  totalMarketValue?: DecimalString;
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
};

export function buildHoldingAllocation(
  ledgerData: LedgerData,
  options: { todayKey: string; mode: ValuationPriceMode },
): HoldingAllocation {
  const valuedPositions = getValuedPositionsFromLedger(ledgerData, options);
  const assetsBySymbol = new Map(
    ledgerData.assets.map((asset) => [asset.symbol, asset]),
  );
  const missingPriceAssets: string[] = [];
  const excludedCurrencyAssets: string[] = [];
  const valued: Array<{
    assetSymbol: string;
    marketValue: DecimalString;
    source: "manual" | "binance";
    asOf: string;
  }> = [];
  const valuationCurrencies: string[] = [];

  for (const item of valuedPositions) {
    if (isZero(item.position.quantity)) {
      continue;
    }
    const asset = assetsBySymbol.get(item.position.assetSymbol);
    if (!asset || !isSupportedValuationCurrency(asset.quoteCurrency)) {
      excludedCurrencyAssets.push(item.position.assetSymbol);
      continue;
    }
    valuationCurrencies.push(item.position.currency);
    if (!item.selectedPrice || item.position.marketValue === undefined) {
      missingPriceAssets.push(item.position.assetSymbol);
      continue;
    }
    valued.push({
      assetSymbol: item.position.assetSymbol,
      marketValue: item.position.marketValue,
      source: item.selectedPrice.actualSource,
      asOf: item.selectedPrice.asOf,
    });
  }

  if (valued.length === 0) {
    return {
      slices: [],
      missingPriceAssets: missingPriceAssets.sort(),
      excludedCurrencyAssets: excludedCurrencyAssets.sort(),
      valuation: createValuationDisplay(
        valuationCurrencies,
        getDefaultValuationCurrency(ledgerData),
      ),
    };
  }

  const totalMarketValue = valued.reduce(
    (total, item) => add(total, item.marketValue),
    "0",
  );
  const slices = valued
    .map((item) => ({
      ...item,
      ratio: toDecimalString(
        divide(item.marketValue, totalMarketValue),
      ),
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
    totalMarketValue,
    missingPriceAssets: missingPriceAssets.sort(),
    excludedCurrencyAssets: excludedCurrencyAssets.sort(),
    valuation: createValuationDisplay(
      valuationCurrencies,
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
  const partition = partitionLedgerFactsForToday(
    ledgerData,
    options.todayKey,
  );
  const sortedTrades = sortTradesForReplay(partition.activeTrades);
  const sortedPrices = sortPriceSnapshotsForReplay(
    ledgerData.priceSnapshots,
    options.todayKey,
  );
  const startDate = getHistoryStartDate(
    sortedTrades,
    options.todayKey,
    options.range,
  );
  const dates = enumerateLedgerDays(startDate, options.todayKey);
  const replayState = createPositionReplayState();
  const assetsBySymbol = new Map(
    ledgerData.assets.map((asset) => [asset.symbol, asset]),
  );
  const defaultValuationCurrency = getDefaultValuationCurrency(ledgerData);
  const priceAccumulators = new Map<string, PriceSelectionAccumulator>();
  for (const asset of ledgerData.assets) {
    priceAccumulators.set(
      asset.symbol,
      createPriceSelectionAccumulator(asset, options.mode),
    );
  }

  let tradeIndex = 0;
  let priceIndex = 0;
  const points: HoldingHistoryPoint[] = [];
  for (const date of dates) {
    while (
      tradeIndex < sortedTrades.length &&
      getLedgerDateKey(sortedTrades[tradeIndex].occurredAt) <= date
    ) {
      applyTradeToReplay(replayState, sortedTrades[tradeIndex]);
      tradeIndex += 1;
    }
    while (
      priceIndex < sortedPrices.length &&
      getLedgerDateKey(sortedPrices[priceIndex].snapshot.recordedAt) <= date
    ) {
      const entry = sortedPrices[priceIndex];
      const accumulator = priceAccumulators.get(
        entry.snapshot.assetSymbol,
      );
      if (accumulator) {
        considerPriceSnapshot(
          accumulator,
          entry.snapshot,
          entry.originalIndex,
        );
      }
      priceIndex += 1;
    }

    points.push(
      createHistoryPoint(
        date,
        getReplayPositions(replayState),
        assetsBySymbol,
        priceAccumulators,
        defaultValuationCurrency,
      ),
    );
  }

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
    { total: number; buys: number; sells: number }
  >();
  const partition = partitionLedgerFactsForToday(ledgerData, todayKey);

  for (const trade of partition.activeTrades) {
    const date = getLedgerDateKey(trade.occurredAt);
    if (date < startDate || date > todayKey) {
      continue;
    }
    const current = counts.get(date) ?? { total: 0, buys: 0, sells: 0 };
    current.total += 1;
    if (trade.type === "buy") {
      current.buys += 1;
    } else {
      current.sells += 1;
    }
    counts.set(date, current);
  }

  const maxCount = Math.max(
    0,
    ...Array.from(counts.values()).map((item) => item.total),
  );
  return enumerateLedgerDays(startDate, todayKey).map((date) => {
    const count = counts.get(date) ?? { total: 0, buys: 0, sells: 0 };
    return {
      date,
      ...count,
      level: getHeatLevel(count.total, maxCount),
    };
  });
}

function createHistoryPoint(
  date: string,
  positions: ReturnType<typeof getReplayPositions>,
  assetsBySymbol: ReadonlyMap<string, Asset>,
  priceAccumulators: ReadonlyMap<string, PriceSelectionAccumulator>,
  defaultValuationCurrency: "USD" | "USDT",
): HoldingHistoryPoint {
  let totalCostBasis: DecimalString = "0";
  let totalMarketValue: DecimalString = "0";
  const missingPriceAssets: string[] = [];
  const excludedCurrencyAssets: string[] = [];
  const unreliableFeeAssets: string[] = [];
  const priceAsOfByAsset: Record<string, string> = {};
  const valuationCurrencies: string[] = [];

  for (const position of positions) {
    const asset = assetsBySymbol.get(position.assetSymbol);
    if (!asset || !isSupportedValuationCurrency(asset.quoteCurrency)) {
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
    const accumulator = priceAccumulators.get(position.assetSymbol);
    const selected = accumulator
      ? getSelectedPrice(accumulator)
      : undefined;
    if (!selected) {
      missingPriceAssets.push(position.assetSymbol);
      continue;
    }

    totalMarketValue = add(
      totalMarketValue,
      multiply(position.quantity, selected.snapshot.price),
    );
    priceAsOfByAsset[position.assetSymbol] = selected.asOf;
  }

  return {
    date,
    ...(unreliableFeeAssets.length === 0 ? { totalCostBasis } : {}),
    ...(missingPriceAssets.length === 0 ? { totalMarketValue } : {}),
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
  sortedTrades: readonly { occurredAt: string }[],
  todayKey: string,
  range: ChartRange,
): string {
  if (range === "all") {
    return sortedTrades.length > 0
      ? getLedgerDateKey(sortedTrades[0].occurredAt)
      : todayKey;
  }
  const days = range === "1d" ? 1 : Number.parseInt(range, 10);
  return addLedgerDays(todayKey, -(days - 1));
}

function sortPriceSnapshotsForReplay(
  snapshots: readonly PriceSnapshot[],
  todayKey: string,
): Array<{ snapshot: PriceSnapshot; originalIndex: number }> {
  return snapshots
    .map((snapshot, originalIndex) => ({ snapshot, originalIndex }))
    .filter(
      (entry) => getLedgerDateKey(entry.snapshot.recordedAt) <= todayKey,
    )
    .sort((left, right) =>
      compareLedgerFactOrder(
        left.snapshot.recordedAt,
        right.snapshot.recordedAt,
        left.originalIndex,
        right.originalIndex,
      ),
    );
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
