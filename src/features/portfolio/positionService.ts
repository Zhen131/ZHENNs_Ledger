import { replayPositions } from "@/core/calculations";
import type {
  LedgerData,
  Position,
  ValuationPriceMode,
} from "@/core/models";
import { partitionLedgerFactsForToday } from "@/core/policies";
import { multiply, subtract } from "@/core/shared";
import {
  captureLedgerTime,
  systemLedgerClock,
} from "@/core/shared";
import {
  selectPriceAsOf,
  type SelectedPrice,
} from "./priceSelectionService";

export type ValuedPosition = {
  position: Position;
  selectedPrice?: SelectedPrice;
};

export function getPositionsFromLedger(
  ledgerData: LedgerData,
  options: {
    todayKey?: string;
    mode?: ValuationPriceMode;
  } = {},
): Position[] {
  return getValuedPositionsFromLedger(ledgerData, options).map(
    (item) => item.position,
  );
}

export function getValuedPositionsFromLedger(
  ledgerData: LedgerData,
  options: {
    todayKey?: string;
    mode?: ValuationPriceMode;
  } = {},
): ValuedPosition[] {
  const todayKey =
    options.todayKey ?? captureLedgerTime(systemLedgerClock).todayKey;
  const partition = partitionLedgerFactsForToday(
    ledgerData,
    todayKey,
  );
  const assetsBySymbol = new Map(
    ledgerData.assets.map((asset) => [asset.symbol, asset]),
  );

  return replayPositions(partition.activeTrades).map((position) => {
    const asset = assetsBySymbol.get(position.assetSymbol);
    if (!asset) {
      return { position };
    }

    const selected = selectPriceAsOf(
      partition.activePriceSnapshots,
      asset,
      todayKey,
      options.mode ?? "auto",
    );
    if (!selected) {
      return { position };
    }

    const marketValue = multiply(
      position.quantity,
      selected.snapshot.price,
    );
    return {
      selectedPrice: selected,
      position: {
        ...position,
        latestPrice: selected.snapshot.price,
        marketValue,
        ...(position.feeAccountingIssues
          ? {}
          : { unrealizedPnl: subtract(marketValue, position.costBasis) }),
      },
    };
  });
}
