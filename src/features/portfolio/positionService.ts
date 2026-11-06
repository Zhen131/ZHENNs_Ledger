/**
 * 这个文件管一件事：算出每种币手里剩多少、现在值多少钱。
 * 它不管按顺序过账的细节，那在 core 的 `positionReplay`；也不管挑哪个价格，那在 `priceSelectionService.ts`。
 * 不显然的决定：手续费算不进成本的币不给浮动盈亏；2026-08-09 定（W12 01A 第 6.3 节）。
 */
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

/**
 * 一种币的持仓，加上估值时挑中的价格。
 * 没挑到价格时，`selectedPrice` 为空。
 */
export type ValuedPosition = {
  position: Position;
  selectedPrice?: SelectedPrice;
};

/**
 * 这个函数回答：今天每种币剩多少、成本多少、值多少？
 * 它只要持仓本身，不要挑中的价格。
 * 举例：买 0.1 BTC 花 6505，卖 0.04 BTC，价格 70000。
 * → 答 BTC 剩 0.06，成本 3903，市值 4200。
 * 不会出错。
 */
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

/**
 * 这个函数回答：今天每种币剩多少、值多少、赚了多少？
 * 先排除今天以后的记录。
 * 再从第一笔到最后一笔，按顺序过一遍买卖和转账。
 * 然后给每种币配上今天能用的价格。
 * 举例：剩 0.06 BTC、成本 3903，价格 70000 → 答市值 4200、浮动盈亏 297。
 * 没有价格的币：只给数量和成本，不给市值。
 * 手续费算不进成本的币：给市值，不给浮动盈亏。
 * 为什么后一条：成本不准，算出的盈亏会冒充准数；2026-08-09 定（W12 01A 第 6.3 节）。
 * 不传 `todayKey` 就看设备时钟取今天。
 * 不会出错。
 */
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

  return replayPositions(
    partition.activeTrades,
    partition.activeAssetTransfers,
  ).map((position) => {
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
