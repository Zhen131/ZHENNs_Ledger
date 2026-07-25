import type {
  Asset,
  PriceSnapshot,
  ValuationPriceMode,
} from "../models";
import {
  isSupportedValuationCurrency,
} from "../policies/ledgerFactPolicy";
import {
  compareLedgerFactOrder,
  getLedgerDateKey,
} from "../utils/ledgerDate";

export type SelectedPrice = {
  snapshot: PriceSnapshot;
  effectiveCurrency: "USD";
  actualSource: "manual" | "binance";
  asOf: string;
};

export function selectPriceAsOf(
  snapshots: readonly PriceSnapshot[],
  asset: Asset,
  dateKey: string,
  mode: ValuationPriceMode,
): SelectedPrice | undefined {
  if (!isSupportedValuationCurrency(asset.quoteCurrency)) {
    return undefined;
  }

  const manual = selectLatestCandidate(
    snapshots,
    asset,
    dateKey,
    "manual",
  );
  const binance = selectLatestCandidate(
    snapshots,
    asset,
    dateKey,
    "binance",
  );

  if (mode === "manual" && manual) {
    return toSelectedPrice(manual, "manual");
  }

  if (!manual) {
    return binance ? toSelectedPrice(binance, "binance") : undefined;
  }
  if (!binance) {
    return toSelectedPrice(manual, "manual");
  }

  const manualDate = getLedgerDateKey(manual.recordedAt);
  const binanceDate = getLedgerDateKey(binance.recordedAt);
  return manualDate > binanceDate
    ? toSelectedPrice(manual, "manual")
    : toSelectedPrice(binance, "binance");
}

function selectLatestCandidate(
  snapshots: readonly PriceSnapshot[],
  asset: Asset,
  dateKey: string,
  source: "manual" | "binance",
): PriceSnapshot | undefined {
  let selected: PriceSnapshot | undefined;
  let selectedIndex = -1;

  snapshots.forEach((snapshot, index) => {
    if (
      snapshot.assetSymbol !== asset.symbol ||
      !isSupportedValuationCurrency(snapshot.currency) ||
      snapshot.currency !== asset.quoteCurrency ||
      getLedgerDateKey(snapshot.recordedAt) > dateKey
    ) {
      return;
    }

    const isManual = snapshot.source === "manual";
    const isBinance =
      snapshot.source === "api" &&
      snapshot.binanceProvenance?.provider === "binance" &&
      snapshot.binanceProvenance.sourceQuoteCurrency === "USDT";
    if (
      (source === "manual" && !isManual) ||
      (source === "binance" && !isBinance)
    ) {
      return;
    }

    if (
      !selected ||
      compareLedgerFactOrder(
        snapshot.recordedAt,
        selected.recordedAt,
        index,
        selectedIndex,
      ) >= 0
    ) {
      selected = snapshot;
      selectedIndex = index;
    }
  });

  return selected;
}

function toSelectedPrice(
  snapshot: PriceSnapshot,
  actualSource: "manual" | "binance",
): SelectedPrice {
  return {
    snapshot,
    effectiveCurrency: "USD",
    actualSource,
    asOf:
      actualSource === "binance"
        ? snapshot.binanceProvenance!.fetchedAt
        : snapshot.recordedAt,
  };
}
