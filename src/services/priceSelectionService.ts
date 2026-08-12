import type {
  Asset,
  PriceSnapshot,
  ValuationPriceMode,
} from "@/core/models";
import {
  isSupportedValuationCurrency,
} from "@/core/policies";
import {
  compareLedgerFactOrder,
  getLedgerDateKey,
} from "@/core/shared";

export type SelectedPrice = {
  snapshot: PriceSnapshot;
  effectiveCurrency: "USD" | "USDT";
  actualSource: "manual" | "binance";
  asOf: string;
};

type PriceCandidate = {
  snapshot: PriceSnapshot;
  index: number;
};

export type PriceSelectionAccumulator = {
  readonly asset: Asset;
  readonly mode: ValuationPriceMode;
  manual?: PriceCandidate;
  binance?: PriceCandidate;
};

export function createPriceSelectionAccumulator(
  asset: Asset,
  mode: ValuationPriceMode,
): PriceSelectionAccumulator {
  return { asset, mode };
}

export function considerPriceSnapshot(
  accumulator: PriceSelectionAccumulator,
  snapshot: PriceSnapshot,
  index: number,
): void {
  const source = classifyCandidate(snapshot, accumulator.asset);
  if (!source) {
    return;
  }

  const current = accumulator[source];
  if (
    !current ||
    compareLedgerFactOrder(
      snapshot.recordedAt,
      current.snapshot.recordedAt,
      index,
      current.index,
    ) >= 0
  ) {
    accumulator[source] = { snapshot, index };
  }
}

export function getSelectedPrice(
  accumulator: PriceSelectionAccumulator,
): SelectedPrice | undefined {
  const manual = accumulator.manual?.snapshot;
  const binance = accumulator.binance?.snapshot;

  if (accumulator.mode === "manual" && manual) {
    return toSelectedPrice(manual, "manual");
  }
  if (!manual) {
    return binance ? toSelectedPrice(binance, "binance") : undefined;
  }
  if (!binance) {
    return toSelectedPrice(manual, "manual");
  }

  return getLedgerDateKey(manual.recordedAt) >
    getLedgerDateKey(binance.recordedAt)
    ? toSelectedPrice(manual, "manual")
    : toSelectedPrice(binance, "binance");
}

export function selectPriceAsOf(
  snapshots: readonly PriceSnapshot[],
  asset: Asset,
  dateKey: string,
  mode: ValuationPriceMode,
): SelectedPrice | undefined {
  if (!isSupportedValuationCurrency(asset.quoteCurrency)) {
    return undefined;
  }

  const accumulator = createPriceSelectionAccumulator(asset, mode);
  snapshots.forEach((snapshot, index) => {
    if (getLedgerDateKey(snapshot.recordedAt) <= dateKey) {
      considerPriceSnapshot(accumulator, snapshot, index);
    }
  });
  return getSelectedPrice(accumulator);
}

function classifyCandidate(
  snapshot: PriceSnapshot,
  asset: Asset,
): "manual" | "binance" | undefined {
  if (
    snapshot.assetSymbol !== asset.symbol ||
    !isSupportedValuationCurrency(snapshot.currency) ||
    snapshot.currency !== asset.quoteCurrency
  ) {
    return undefined;
  }
  if (snapshot.source === "manual") {
    return "manual";
  }
  return snapshot.source === "api" &&
    snapshot.binanceProvenance?.provider === "binance" &&
    snapshot.binanceProvenance.sourceQuoteCurrency === "USDT"
    ? "binance"
    : undefined;
}

function toSelectedPrice(
  snapshot: PriceSnapshot,
  actualSource: "manual" | "binance",
): SelectedPrice {
  return {
    snapshot,
    effectiveCurrency: snapshot.currency as "USD" | "USDT",
    actualSource,
    asOf:
      actualSource === "binance"
        ? snapshot.binanceProvenance!.fetchedAt
        : snapshot.recordedAt,
  };
}
