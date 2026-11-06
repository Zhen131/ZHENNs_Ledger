/**
 * 这个文件管给持仓配上最近一次记下来的价格。
 * 配上以后就能算出现在值多少。
 * 它不管按顺序过一遍，那在 positionReplay.ts；也不管现金，那在 cashReplay.ts。
 * 没有特别的决定。
 */

import type {
  AssetTransfer,
  Position,
  PriceSnapshot,
  Trade,
} from "@/core/models";
import {
  multiply,
  subtract,
} from "@/core/shared";
import {
  compareLedgerFactOrder,
  toPriceSnapshotOrderInput,
} from "@/core/shared";
import { replayPositions } from "./positionReplay";

/**
 * 这个函数回答：每种币剩多少、成本多少、值多少钱？
 * 它把买卖和转移从第一笔到最后一笔按顺序过一遍。
 * 过完再给每种币配上最近一次记下来的价格。
 * 有价格时，算出市值和没卖部分的盈亏。
 * 举例：剩 0.06 BTC，成本 3903，最近价格 70000 → 答市值 4200，未实现盈亏 297。
 * 手续费算不进来的币，不给未实现盈亏。
 *
 * 真正按顺序过一遍的活，全交给 positionReplay。
 *
 * 什么时候出错：某笔卖的比手里多，直接抛错。
 * 不给半成品。
 * 整本账的检查（ledgerDataValidator）就靠它抛不抛错。
 * 它以此判断买卖顺序有没有矛盾。
 */
export function calculatePositions(
  trades: Trade[],
  priceSnapshots: PriceSnapshot[] = [],
  assetTransfers: AssetTransfer[] = [],
): Position[] {
  return replayPositions(trades, assetTransfers).map((position) =>
    attachLegacyLatestPrice(position, priceSnapshots),
  );
}

function attachLegacyLatestPrice(
  position: Position,
  priceSnapshots: readonly PriceSnapshot[],
): Position {
  let latest: PriceSnapshot | undefined;

  priceSnapshots.forEach((snapshot) => {
    if (
      snapshot.assetSymbol !== position.assetSymbol ||
      snapshot.currency !== position.currency
    ) {
      return;
    }

    if (
      !latest ||
      compareLedgerFactOrder(
        toPriceSnapshotOrderInput(snapshot),
        toPriceSnapshotOrderInput(latest),
      ) >= 0
    ) {
      latest = snapshot;
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
