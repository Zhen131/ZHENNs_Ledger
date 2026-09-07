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
import {
  isSupportedValuationCurrency,
  partitionLedgerFactsForToday,
} from "@/core/policies";
import {
  add,
  absolute,
  compareLedgerFactOrder,
  divide,
  isGreaterThan,
  isLessThan,
  isNegative,
  isPositive,
  isZero,
  multiply,
  subtract,
  toDecimalString,
} from "@/core/shared";
import {
  addLedgerDays,
  enumerateLedgerDays,
  getLedgerDateKey,
} from "@/core/shared";
import {
  buildLedgerProjection,
  considerPriceSnapshot,
  createPriceSelectionAccumulator,
  createValuationDisplay,
  getSelectedPrice,
  type LedgerProjection,
  type PriceSelectionAccumulator,
  type SelectedPrice,
  type ValuationDisplay,
} from "@/features/portfolio";

export type HoldingAllocationGroupedMember = {
  assetSymbol: string;
  marketValue: DecimalString;
};

export type HoldingAllocationSlice = {
  assetSymbol: string;
  marketValue: DecimalString;
  ratio: DecimalString;
  source: "manual" | "binance" | "cash" | "grouped";
  asOf: string;
  groupedMembers?: HoldingAllocationGroupedMember[];
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

const MIN_STANDALONE_ALLOCATION_RATIO = "0.02";
const MAX_ALLOCATION_SLICES = 8;
const MAX_VISIBLE_SLICES_WITH_GROUP = MAX_ALLOCATION_SLICES - 1;

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

  const sortedPositiveValues = valued
    .filter((item) => isPositive(item.marketValue))
    .sort(compareAllocationMarketValue);
  const slices = isZero(geometryTotal)
    ? []
    : groupHoldingAllocationSlices(
        sortedPositiveValues.map<HoldingAllocationSlice>((item) => ({
          ...item,
          ratio: toDecimalString(divide(item.marketValue, geometryTotal)),
        })),
        geometryTotal,
        options.todayKey,
      );

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

function compareAllocationMarketValue(
  left: Pick<HoldingAllocationSlice, "assetSymbol" | "marketValue">,
  right: Pick<HoldingAllocationSlice, "assetSymbol" | "marketValue">,
): number {
  if (isGreaterThan(left.marketValue, right.marketValue)) return -1;
  if (isGreaterThan(right.marketValue, left.marketValue)) return 1;
  return left.assetSymbol < right.assetSymbol
    ? -1
    : left.assetSymbol > right.assetSymbol
      ? 1
      : 0;
}

function groupHoldingAllocationSlices(
  sortedSlices: readonly HoldingAllocationSlice[],
  geometryTotal: DecimalString,
  todayKey: string,
): HoldingAllocationSlice[] {
  const standalone = sortedSlices.filter(
    (slice) => !isLessThan(slice.ratio, MIN_STANDALONE_ALLOCATION_RATIO),
  );
  const belowThreshold = sortedSlices.filter((slice) =>
    isLessThan(slice.ratio, MIN_STANDALONE_ALLOCATION_RATIO),
  );

  if (belowThreshold.length === 0 && standalone.length <= MAX_ALLOCATION_SLICES) {
    return standalone;
  }
  if (
    belowThreshold.length > 0 &&
    standalone.length + 1 <= MAX_ALLOCATION_SLICES
  ) {
    return [
      ...standalone,
      createGroupedAllocationSlice(belowThreshold, geometryTotal, todayKey),
    ];
  }

  const visible = sortedSlices.slice(0, MAX_VISIBLE_SLICES_WITH_GROUP);
  const grouped = sortedSlices.slice(MAX_VISIBLE_SLICES_WITH_GROUP);
  return [
    ...visible,
    createGroupedAllocationSlice(grouped, geometryTotal, todayKey),
  ];
}

function createGroupedAllocationSlice(
  members: readonly HoldingAllocationSlice[],
  geometryTotal: DecimalString,
  todayKey: string,
): HoldingAllocationSlice {
  const marketValue = members.reduce<DecimalString>(
    (sum, member) => add(sum, member.marketValue),
    "0",
  );
  return {
    assetSymbol: "其他",
    marketValue,
    ratio: toDecimalString(divide(marketValue, geometryTotal)),
    source: "grouped",
    asOf: todayKey,
    groupedMembers: members.map(({ assetSymbol, marketValue: memberValue }) => ({
      assetSymbol,
      marketValue: memberValue,
    })),
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
  const priceFacts = ledgerData.priceSnapshots
    .map((snapshot, index) => ({ snapshot, index }))
    .sort((left, right) =>
      compareLedgerFactOrder(
        { occurredAt: left.snapshot.recordedAt, arrayIndex: left.index },
        { occurredAt: right.snapshot.recordedAt, arrayIndex: right.index },
        "array-index",
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
      getLedgerDateKey(priceFacts[priceIndex].snapshot.recordedAt) <= date
    ) {
      const candidate = priceFacts[priceIndex];
      const accumulator = priceAccumulators.get(
        candidate.snapshot.assetSymbol,
      );
      if (accumulator) {
        considerPriceSnapshot(
          accumulator,
          candidate.snapshot,
          candidate.index,
        );
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

export function updateTradeHeatmapForAppendedTrade(
  previous: readonly TradeHeatmapDay[],
  trade: LedgerData["trades"][number],
  todayKey: string,
): TradeHeatmapDay[] {
  const date = getLedgerDateKey(trade.occurredAt);
  const startDate = addLedgerDays(todayKey, -364);
  if (date < startDate || date > todayKey) return [...previous];
  const updated = previous.map((day) => {
    if (day.date !== date) return day;
    const activityGroups = day.activityGroups.map((group) => ({ ...group }));
    const group = activityGroups.find(
      (candidate) =>
        candidate.assetSymbol === trade.assetSymbol &&
        candidate.type === trade.type,
    );
    if (group) {
      group.count += 1;
    } else {
      activityGroups.push({
        assetSymbol: trade.assetSymbol,
        type: trade.type,
        count: 1,
      });
    }
    activityGroups.sort(compareHeatmapActivityGroups);
    return {
      ...day,
      total: day.total + 1,
      buys: day.buys + (trade.type === "buy" ? 1 : 0),
      sells: day.sells + (trade.type === "sell" ? 1 : 0),
      activityGroups,
    };
  });
  const maxCount = Math.max(0, ...updated.map((day) => day.total));
  return updated.map((day) => ({
    ...day,
    level: getHeatLevel(day.total, maxCount),
  }));
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

function compareHeatmapActivityGroups(
  left: TradeHeatmapActivityGroup,
  right: TradeHeatmapActivityGroup,
): number {
  if (left.count !== right.count) {
    return right.count - left.count;
  }
  const assetOrder =
    left.assetSymbol < right.assetSymbol
      ? -1
      : left.assetSymbol > right.assetSymbol
        ? 1
        : 0;
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
          .sort((left, right) =>
            left < right ? -1 : left > right ? 1 : 0,
          )[0]
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
