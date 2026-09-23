import type {
  DecimalString,
  LedgerData,
  Position,
  ValuationPriceMode,
} from "@/core/models";
import {
  applyAssetTransferToReplay,
  applyTradeToReplay,
  calculateCashEventUsdtDelta,
  calculateTradeUsdtCashDelta,
  createPositionReplayState,
  getReplayPositions,
  sortPositionFactsForReplay,
} from "@/core/calculations";
import { isSupportedValuationCurrency } from "@/core/policies";
import {
  add,
  absolute,
  compareLedgerFactOrder,
  isNegative,
  isZero,
  multiply,
  subtract,
  toPriceSnapshotOrderInput,
} from "@/core/shared";
import {
  addLedgerDays,
  enumerateLedgerDays,
  getLedgerDateKey,
} from "@/core/shared";
import {
  considerPriceSnapshot,
  createPriceSelectionAccumulator,
  createValuationDisplay,
  getSelectedPrice,
  type LedgerProjection,
  type PriceSelectionAccumulator,
  type SelectedPrice,
} from "@/features/portfolio";
import type { ChartRange, HoldingHistoryPoint } from "./chartDataService";
import { getDefaultValuationCurrency } from "./chartDataServiceShared";

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
      ...ledgerData.assetTransfers.map((transfer) => transfer.occurredAt),
    ],
    options.todayKey,
    options.range,
  );
  const dates = enumerateLedgerDays(startDate, options.todayKey);
  const defaultValuationCurrency = getDefaultValuationCurrency(ledgerData);
  const positionFacts = sortPositionFactsForReplay(
    ledgerData.trades,
    ledgerData.assetTransfers,
  );
  const cashFacts = createHistoricalCashFacts(ledgerData);
  const priceFacts = [...ledgerData.priceSnapshots].sort((left, right) =>
    compareLedgerFactOrder(
      toPriceSnapshotOrderInput(left),
      toPriceSnapshotOrderInput(right),
    ),
  );
  const positionState = createPositionReplayState();
  const priceAccumulators = new Map<string, PriceSelectionAccumulator>();
  for (const asset of ledgerData.assets) {
    priceAccumulators.set(
      asset.symbol,
      createPriceSelectionAccumulator(asset, options.mode),
    );
  }

  let cashBalance: DecimalString = "0";
  let positionIndex = 0;
  let cashIndex = 0;
  let priceIndex = 0;
  const points = dates.map((date) => {
    while (
      positionIndex < positionFacts.length &&
      getLedgerDateKey(positionFacts[positionIndex].occurredAt) <= date
    ) {
      const candidate = positionFacts[positionIndex];
      if (candidate.kind === "trade") {
        applyTradeToReplay(positionState, candidate.fact);
      } else {
        applyAssetTransferToReplay(positionState, candidate.fact);
      }
      positionIndex += 1;
    }
    while (
      cashIndex < cashFacts.length &&
      getLedgerDateKey(cashFacts[cashIndex].occurredAt) <= date
    ) {
      cashBalance = add(cashBalance, cashFacts[cashIndex].delta);
      cashIndex += 1;
    }
    while (
      priceIndex < priceFacts.length &&
      getLedgerDateKey(priceFacts[priceIndex].recordedAt) <= date
    ) {
      const candidate = priceFacts[priceIndex];
      const accumulator = priceAccumulators.get(candidate.assetSymbol);
      if (accumulator) {
        considerPriceSnapshot(accumulator, candidate);
      }
      priceIndex += 1;
    }

    return createHistoryPoint(
      date,
      valueHistoricalPositions(
        getReplayPositions(positionState),
        priceAccumulators,
      ),
      cashBalance,
      defaultValuationCurrency,
    );
  });

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

export function updateHoldingHistoryForCurrentDay(
  previous: readonly HoldingHistoryPoint[],
  ledgerData: LedgerData,
  projection: LedgerProjection,
  options: Readonly<{ todayKey: string; range: ChartRange }>,
): HoldingHistoryPoint[] | null {
  const todayPoint = createHistoryPointFromProjection(
    options.todayKey,
    ledgerData,
    projection,
  );
  if (options.range === "1d") {
    if (previous.length !== 2) return null;
    return [
      {
        ...todayPoint,
        date: `${options.todayKey}T00:00:00`,
        displayBoundary: "start",
      },
      {
        ...todayPoint,
        date: `${options.todayKey}T23:59:59`,
        displayBoundary: "end",
      },
    ];
  }
  if (previous.at(-1)?.date !== options.todayKey) return null;
  return [...previous.slice(0, -1), todayPoint];
}

function createHistoryPointFromProjection(
  date: string,
  ledgerData: LedgerData,
  projection: LedgerProjection,
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
    if (position.feeAccountingIssues) {
      unreliableFeeAssets.push(position.assetSymbol);
    }
    if (isZero(position.quantity)) continue;
    if (!position.feeAccountingIssues) {
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
  return {
    date,
    ...(unreliableFeeAssets.length === 0 ? { totalCostBasis } : {}),
    ...(missingPriceAssets.length === 0
      ? { totalMarketValue: add(totalMarketValue, projection.cash.balance) }
      : {}),
    assetMarketValue: totalMarketValue,
    cashBalance: projection.cash.balance,
    cashDeficit: projection.cash.deficit,
    missingPriceAssets: missingPriceAssets.sort(),
    excludedCurrencyAssets: excludedCurrencyAssets.sort(),
    unreliableFeeAssets: unreliableFeeAssets.sort(),
    priceAsOfByAsset,
    valuation: createValuationDisplay(
      valuationCurrencies,
      getDefaultValuationCurrency(ledgerData),
    ),
  };
}

function createHistoryPoint(
  date: string,
  valuedPositions: readonly HistoricalValuedPosition[],
  cashBalance: DecimalString,
  defaultValuationCurrency: "USD" | "USDT",
): HoldingHistoryPoint {
  let totalCostBasis: DecimalString = "0";
  let totalMarketValue: DecimalString = "0";
  const missingPriceAssets: string[] = [];
  const excludedCurrencyAssets: string[] = [];
  const unreliableFeeAssets: string[] = [];
  const priceAsOfByAsset: Record<string, string> = {};
  const valuationCurrencies: string[] = [];

  for (const { position, selectedPrice } of valuedPositions) {
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
    if (!selectedPrice || position.marketValue === undefined) {
      missingPriceAssets.push(position.assetSymbol);
      continue;
    }

    totalMarketValue = add(totalMarketValue, position.marketValue);
    priceAsOfByAsset[position.assetSymbol] = selectedPrice.asOf;
  }

  return {
    date,
    ...(unreliableFeeAssets.length === 0 ? { totalCostBasis } : {}),
    ...(missingPriceAssets.length === 0
      ? { totalMarketValue: add(totalMarketValue, cashBalance) }
      : {}),
    assetMarketValue: totalMarketValue,
    cashBalance,
    cashDeficit: isNegative(cashBalance) ? absolute(cashBalance) : "0",
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

type HistoricalValuedPosition = Readonly<{
  position: Position;
  selectedPrice?: SelectedPrice;
}>;

type HistoricalCashFact = Readonly<{
  id: string;
  kind: "trade" | "cash-event";
  occurredAt: string;
  createdAt: string;
  delta: DecimalString;
}>;

function createHistoricalCashFacts(
  ledgerData: Pick<LedgerData, "trades" | "cashEvents">,
): HistoricalCashFact[] {
  return [
    ...ledgerData.trades.map(
      (trade): HistoricalCashFact => ({
        id: trade.id,
        kind: "trade",
        occurredAt: trade.occurredAt,
        createdAt: trade.createdAt,
        delta: calculateTradeUsdtCashDelta(trade),
      }),
    ),
    ...ledgerData.cashEvents.map(
      (cashEvent): HistoricalCashFact => ({
        id: cashEvent.id,
        kind: "cash-event",
        occurredAt: cashEvent.occurredAt,
        createdAt: cashEvent.createdAt,
        delta: calculateCashEventUsdtDelta(cashEvent),
      }),
    ),
  ].sort((left, right) => compareLedgerFactOrder(left, right));
}

function valueHistoricalPositions(
  positions: readonly Position[],
  priceAccumulators: ReadonlyMap<string, PriceSelectionAccumulator>,
): HistoricalValuedPosition[] {
  return positions.map((position) => {
    const accumulator = priceAccumulators.get(position.assetSymbol);
    const selectedPrice = accumulator
      ? getSelectedPrice(accumulator)
      : undefined;
    if (!selectedPrice) return { position };
    const marketValue = multiply(
      position.quantity,
      selectedPrice.snapshot.price,
    );
    return {
      selectedPrice,
      position: {
        ...position,
        latestPrice: selectedPrice.snapshot.price,
        marketValue,
        ...(position.feeAccountingIssues
          ? {}
          : { unrealizedPnl: subtract(marketValue, position.costBasis) }),
      },
    };
  });
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

function getHistoryStartDate(
  occurredAtValues: readonly string[],
  todayKey: string,
  range: ChartRange,
): string {
  if (range === "all") {
    return occurredAtValues.length > 0
      ? occurredAtValues
          .map(getLedgerDateKey)
          .sort((left, right) =>
            left < right ? -1 : left > right ? 1 : 0,
          )[0]
      : todayKey;
  }
  const days = range === "1d" ? 1 : Number.parseInt(range, 10);
  return addLedgerDays(todayKey, -(days - 1));
}
