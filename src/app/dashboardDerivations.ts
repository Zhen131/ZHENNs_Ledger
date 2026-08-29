import type { LedgerData, ValuationPriceMode } from "@/core/models";
import {
  buildHoldingAllocation,
  buildHoldingHistory,
  buildTradeHeatmap,
  type ChartRange,
} from "@/features/charts";
import {
  buildLedgerPnlSummary,
  buildLedgerProjection,
  updateLedgerProjectionForAppendedFact,
  type AppendedLedgerFact,
} from "@/features/portfolio";

export type DashboardDerivationOptions = Readonly<{
  todayKey: string;
  valuationPriceMode: ValuationPriceMode;
  chartRange: ChartRange;
}>;

export type DashboardDerivations = Readonly<{
  projection: ReturnType<typeof buildLedgerProjection>;
  pnlSummary: ReturnType<typeof buildLedgerPnlSummary>;
  allocation: ReturnType<typeof buildHoldingAllocation>;
  history: ReturnType<typeof buildHoldingHistory>;
  heatmap: ReturnType<typeof buildTradeHeatmap>;
}>;

export type DashboardDerivationUpdate = Readonly<{
  values: DashboardDerivations;
  mode: "incremental" | "full-fallback";
  appended?: AppendedLedgerFact;
  cashReplay?: "unchanged" | "appended" | "full-fallback";
  positionReplay?: "unchanged" | "affected-asset" | "full-fallback";
}>;

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
  return {
    values: {
      projection,
      pnlSummary:
        appended.kind === "cash-event"
          ? previousValues.pnlSummary
          : buildLedgerPnlSummary(nextLedger, {
              todayKey: options.todayKey,
              mode: options.valuationPriceMode,
            }),
      allocation: buildHoldingAllocation(nextLedger, {
        todayKey: options.todayKey,
        mode: options.valuationPriceMode,
        projection,
      }),
      history: buildHoldingHistory(nextLedger, {
        todayKey: options.todayKey,
        mode: options.valuationPriceMode,
        range: options.chartRange,
      }),
      heatmap:
        appended.kind === "trade"
          ? buildTradeHeatmap(nextLedger, options.todayKey)
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
