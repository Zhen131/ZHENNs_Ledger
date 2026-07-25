import { calculatePositions } from "../calculators/positionCalculator";
import type {
  LedgerData,
  Position,
  ValuationPriceMode,
} from "../models";
import { partitionLedgerFactsForToday } from "../policies/ledgerFactPolicy";
import { multiply, subtract } from "../utils/decimalMath";
import { createSystemLedgerClock } from "../utils/ledgerDate";
import { selectPriceAsOf } from "./priceSelectionService";

export function getPositionsFromLedger(
  ledgerData: LedgerData,
  options: {
    todayKey?: string;
    mode?: ValuationPriceMode;
  } = {},
): Position[] {
  const todayKey = options.todayKey ?? createSystemLedgerClock().todayKey();
  const partition = partitionLedgerFactsForToday(
    ledgerData,
    todayKey,
  );
  const assetsBySymbol = new Map(
    ledgerData.assets.map((asset) => [asset.symbol, asset]),
  );

  return calculatePositions(partition.activeTrades, []).map((position) => {
    const asset = assetsBySymbol.get(position.assetSymbol);
    if (!asset) {
      return position;
    }

    const selected = selectPriceAsOf(
      partition.activePriceSnapshots,
      asset,
      todayKey,
      options.mode ?? "auto",
    );
    if (!selected) {
      return position;
    }

    const marketValue = multiply(
      position.quantity,
      selected.snapshot.price,
    );
    return {
      ...position,
      latestPrice: selected.snapshot.price,
      marketValue,
      unrealizedPnl: subtract(marketValue, position.costBasis),
    };
  });
}
