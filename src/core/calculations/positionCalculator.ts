import type {
  Position,
  PriceSnapshot,
  Trade,
} from "@/core/models";
import {
  multiply,
  subtract,
} from "@/core/shared";
import { compareLedgerFactOrder } from "@/core/shared";
import { replayPositions } from "./positionReplay";

/**
 * 从交易事实派生当前持仓。交易重放统一委托 positionReplay；
 * 本函数保留旧调用方的快照参数，只负责兼容性的价格字段装配。
 */
export function calculatePositions(
  trades: Trade[],
  priceSnapshots: PriceSnapshot[] = [],
): Position[] {
  return replayPositions(trades).map((position) =>
    attachLegacyLatestPrice(position, priceSnapshots),
  );
}

function attachLegacyLatestPrice(
  position: Position,
  priceSnapshots: readonly PriceSnapshot[],
): Position {
  let latest: PriceSnapshot | undefined;
  let latestIndex = -1;

  priceSnapshots.forEach((snapshot, index) => {
    if (
      snapshot.assetSymbol !== position.assetSymbol ||
      snapshot.currency !== position.currency
    ) {
      return;
    }

    if (
      !latest ||
      compareLedgerFactOrder(
        snapshot.recordedAt,
        latest.recordedAt,
        index,
        latestIndex,
      ) >= 0
    ) {
      latest = snapshot;
      latestIndex = index;
    }
  });

  if (!latest) {
    return position;
  }

  const marketValue = multiply(position.quantity, latest.price);
  return {
    ...position,
    latestPrice: latest.price,
    marketValue,
    ...(position.feeAccountingIssues
      ? {}
      : { unrealizedPnl: subtract(marketValue, position.costBasis) }),
  };
}
