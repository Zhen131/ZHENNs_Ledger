/**
 * 这个文件管首页那几样数怎么从账本算出来。
 * 账本只多一笔时，它省着算。
 * 每样数怎么算在 `features/portfolio` 和 `features/charts`，这里只决定什么时候重算。
 * 不显然的决定：只多一笔时，接着上次结果往下算。
 * 2026-08-29 提交 c6f7644 起这样做。
 */
import type { LedgerData, ValuationPriceMode } from "@/core/models";
import {
  buildHoldingAllocation,
  buildHoldingHistory,
  buildTradeHeatmap,
  updateHoldingHistoryForCurrentDay,
  updateTradeHeatmapForAppendedTrade,
  type ChartRange,
} from "@/features/charts";
import {
  buildLedgerPnlSummary,
  buildLedgerProjection,
  updateLedgerProjectionForAppendedFact,
  updateLedgerPnlSummaryForAppendedTrade,
  type AppendedLedgerFact,
} from "@/features/portfolio";

/** 算首页数要的条件：今天哪天，估值用哪种价，走势看多长。 */
export type DashboardDerivationOptions = Readonly<{
  todayKey: string;
  valuationPriceMode: ValuationPriceMode;
  chartRange: ChartRange;
}>;

/** 首页要的五样数：持仓和现金，盈亏，分布，走势，热力图。 */
export type DashboardDerivations = Readonly<{
  projection: ReturnType<typeof buildLedgerProjection>;
  pnlSummary: ReturnType<typeof buildLedgerPnlSummary>;
  allocation: ReturnType<typeof buildHoldingAllocation>;
  history: ReturnType<typeof buildHoldingHistory>;
  heatmap: ReturnType<typeof buildTradeHeatmap>;
}>;

type DashboardDerivationUpdate = Readonly<{
  values: DashboardDerivations;
  mode: "incremental" | "full-fallback";
  appended?: AppendedLedgerFact;
  cashReplay?: "unchanged" | "appended" | "full-fallback";
  positionReplay?: "unchanged" | "affected-asset" | "full-fallback";
}>;

/**
 * 上一次算好的首页数，按条件分开存着。
 * 记着是哪一本账本、哪一版账本数据；换了账本就整个作废。
 */
export type DashboardDerivationCache = Readonly<{
  ledgerEpoch: number;
  ledgerData: LedgerData;
  entries: ReadonlyMap<string, DashboardDerivations>;
  generation: number;
}>;

type DashboardDerivationCacheResolution = Readonly<{
  cache: DashboardDerivationCache;
  values: DashboardDerivations;
  mode:
    | "cache-hit"
    | "query-miss"
    | "fact-change-incremental"
    | "fact-change-full"
    | "session-reset";
}>;

/**
 * 这个函数从头把首页五样数全部算一遍。
 * 举例：买 0.1 BTC 成交 6500、手续费 5，再卖 0.04 BTC 成交 2800、手续费 3。
 * → 答剩余持仓成本 3903 USDT，已实现盈亏 195 USDT，手里 0.06 BTC。
 * 账本合格时不会出错。
 */
export function buildDashboardDerivations(
  ledgerData: LedgerData,
  options: DashboardDerivationOptions,
): DashboardDerivations {
  const projection = buildLedgerProjection(ledgerData, {
    asOf: options.todayKey,
    mode: options.valuationPriceMode,
  });
  return {
    projection,
    pnlSummary: buildLedgerPnlSummary(ledgerData, {
      todayKey: options.todayKey,
      mode: options.valuationPriceMode,
    }),
    allocation: buildHoldingAllocation(ledgerData, {
      todayKey: options.todayKey,
      mode: options.valuationPriceMode,
      projection,
    }),
    history: buildHoldingHistory(ledgerData, {
      todayKey: options.todayKey,
      mode: options.valuationPriceMode,
      range: options.chartRange,
    }),
    heatmap: buildTradeHeatmap(ledgerData, options.todayKey),
  };
}

/**
 * 这个函数回答：这次首页的数，能不能用上一次的结果？
 * 换了账本就从头算；账本没变、条件算过，直接拿旧的。
 * 账本只多了一笔，就接着旧结果往下算；别的变化从头算。
 * 举例：同一本账，走势从 30 天换成 7 天 → 答新条件从头算。
 * 30 天那份结果留着，换回来时直接用。
 * 返回新的存档、这次的数，和用了哪种方式。账本合格时不会出错。
 */
export function resolveDashboardDerivations(
  previousCache: DashboardDerivationCache | null,
  ledgerData: LedgerData,
  options: DashboardDerivationOptions,
  ledgerEpoch: number,
): DashboardDerivationCacheResolution {
  const key = dashboardDerivationOptionsKey(options);
  if (!previousCache || previousCache.ledgerEpoch !== ledgerEpoch) {
    const values = buildDashboardDerivations(ledgerData, options);
    return {
      cache: createDashboardDerivationCache(
        ledgerEpoch,
        ledgerData,
        key,
        values,
        (previousCache?.generation ?? 0) + 1,
      ),
      values,
      mode: "session-reset",
    };
  }

  if (previousCache.ledgerData === ledgerData) {
    const hit = previousCache.entries.get(key);
    if (hit) {
      return { cache: previousCache, values: hit, mode: "cache-hit" };
    }
    const values = buildDashboardDerivations(ledgerData, options);
    return {
      cache: {
        ...previousCache,
        entries: new Map(previousCache.entries).set(key, values),
      },
      values,
      mode: "query-miss",
    };
  }

  const previousValues = previousCache.entries.get(key);
  const update = previousValues
    ? updateDashboardDerivationsForAppend(
        previousValues,
        previousCache.ledgerData,
        ledgerData,
        options,
      )
    : null;
  const values =
    update?.values ?? buildDashboardDerivations(ledgerData, options);
  return {
    cache: createDashboardDerivationCache(
      ledgerEpoch,
      ledgerData,
      key,
      values,
      previousCache.generation + 1,
    ),
    values,
    mode:
      update?.mode === "incremental"
        ? "fact-change-incremental"
        : "fact-change-full",
  };
}

/**
 * 这个函数在账本只多一笔时，接着上次结果往下算首页的数。
 * 多的是今天的一笔买卖，走势只更新今天那一格。
 * 看不出只多一笔，或持仓没法接着算，就退回从头算。
 * 举例：已有 0.1 BTC，再记卖 0.04 BTC → 答手里 0.06 BTC。
 * 和从头算的结果一样。
 * 账本合格时不会出错。
 */
export function updateDashboardDerivationsForAppend(
  previousValues: DashboardDerivations,
  previousLedger: LedgerData,
  nextLedger: LedgerData,
  options: DashboardDerivationOptions,
): DashboardDerivationUpdate {
  const appended = detectAppendedLedgerFact(previousLedger, nextLedger);
  if (!appended) {
    return {
      values: buildDashboardDerivations(nextLedger, options),
      mode: "full-fallback",
    };
  }
  const incrementalProjection = updateLedgerProjectionForAppendedFact(
    previousValues.projection,
    nextLedger,
    appended,
    { asOf: options.todayKey, mode: options.valuationPriceMode },
  );
  if (incrementalProjection.positionReplay === "full-fallback") {
    return {
      values: buildDashboardDerivations(nextLedger, options),
      mode: "full-fallback",
      appended,
      cashReplay: incrementalProjection.cashReplay,
      positionReplay: incrementalProjection.positionReplay,
    };
  }

  const projection = incrementalProjection.projection;
  const appendedTrade = appended.kind === "trade" ? appended.fact : null;
  const incrementalPnl = appendedTrade
    ? updateLedgerPnlSummaryForAppendedTrade(
        previousValues.pnlSummary,
        appendedTrade,
        projection,
        options.todayKey,
      )
    : null;
  const incrementalHistory =
    appendedTrade &&
    appendedTrade.occurredAt.slice(0, 10) === options.todayKey
      ? updateHoldingHistoryForCurrentDay(
          previousValues.history,
          nextLedger,
          projection,
          { todayKey: options.todayKey, range: options.chartRange },
        )
      : null;
  return {
    values: {
      projection,
      pnlSummary:
        appended.kind === "cash-event"
          ? previousValues.pnlSummary
          : incrementalPnl ?? buildLedgerPnlSummary(nextLedger, {
              todayKey: options.todayKey,
              mode: options.valuationPriceMode,
            }),
      allocation: buildHoldingAllocation(nextLedger, {
        todayKey: options.todayKey,
        mode: options.valuationPriceMode,
        projection,
      }),
      history:
        incrementalHistory ??
        buildHoldingHistory(nextLedger, {
          todayKey: options.todayKey,
          mode: options.valuationPriceMode,
          range: options.chartRange,
        }),
      heatmap:
        appendedTrade
          ? updateTradeHeatmapForAppendedTrade(
              previousValues.heatmap,
              appendedTrade,
              options.todayKey,
            )
          : previousValues.heatmap,
    },
    mode: "incremental",
    appended,
    cashReplay: incrementalProjection.cashReplay,
    positionReplay: incrementalProjection.positionReplay,
  };
}

function detectAppendedLedgerFact(
  previous: LedgerData,
  next: LedgerData,
): AppendedLedgerFact | null {
  if (
    next.trades.length === previous.trades.length + 1 &&
    samePrefix(previous.trades, next.trades) &&
    next.cashEvents === previous.cashEvents &&
    next.assetTransfers === previous.assetTransfers &&
    next.priceSnapshots === previous.priceSnapshots
  ) {
    return { kind: "trade", fact: next.trades.at(-1)! };
  }
  if (
    next.cashEvents.length === previous.cashEvents.length + 1 &&
    samePrefix(previous.cashEvents, next.cashEvents) &&
    next.trades === previous.trades &&
    next.assetTransfers === previous.assetTransfers &&
    next.priceSnapshots === previous.priceSnapshots
  ) {
    return { kind: "cash-event", fact: next.cashEvents.at(-1)! };
  }
  if (
    next.assetTransfers.length === previous.assetTransfers.length + 1 &&
    samePrefix(previous.assetTransfers, next.assetTransfers) &&
    next.trades === previous.trades &&
    next.cashEvents === previous.cashEvents &&
    next.priceSnapshots === previous.priceSnapshots
  ) {
    return {
      kind: "asset-transfer",
      fact: next.assetTransfers.at(-1)!,
    };
  }
  if (
    next.priceSnapshots.length === previous.priceSnapshots.length + 1 &&
    samePrefix(previous.priceSnapshots, next.priceSnapshots) &&
    next.trades === previous.trades &&
    next.cashEvents === previous.cashEvents &&
    next.assetTransfers === previous.assetTransfers
  ) {
    return {
      kind: "price-snapshot",
      fact: next.priceSnapshots.at(-1)!,
    };
  }
  return null;
}

function samePrefix<T>(
  previous: readonly T[],
  next: readonly T[],
): boolean {
  return previous.every((value, index) => next[index] === value);
}

function createDashboardDerivationCache(
  ledgerEpoch: number,
  ledgerData: LedgerData,
  key: string,
  values: DashboardDerivations,
  generation: number,
): DashboardDerivationCache {
  return {
    ledgerEpoch,
    ledgerData,
    entries: new Map([[key, values]]),
    generation,
  };
}

function dashboardDerivationOptionsKey(
  options: DashboardDerivationOptions,
): string {
  return [
    options.todayKey,
    options.valuationPriceMode,
    options.chartRange,
  ].join("\u0000");
}
