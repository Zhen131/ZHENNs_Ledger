import type {
  DecimalString,
  Position,
  PriceSnapshot,
  Trade,
} from "../models";
import {
  add,
  divide,
  isGreaterThan,
  isZero,
  multiply,
  subtract,
  toDecimalString,
} from "../utils/decimalMath";

/**
 * PositionAccumulator 是计算过程中的 internal state。
 *
 * 它不是最终要给 UI / service 使用的 Position，而是 calculator 在遍历 Trade[]
 * 时临时维护的“草稿仓位”。等所有交易都处理完，再统一转成正式 Position。
 */
type PositionAccumulator = {
  assetSymbol: string;
  quantity: DecimalString;
  costBasis: DecimalString;
  realizedPnl: DecimalString;
  currency: string;
};

/**
 * 从原始交易事实 Trade[] 推导当前持仓 Position[]。
 *
 * Design notes:
 * - 这是 pure calculator：不读写 storage，不调用 repository，不处理 UI 文案。
 * - Position 不保存；每次需要时都可以由 Trade[] 重新计算。
 * - v1 只处理 buy / sell 和 PriceSnapshot，不处理转仓或空投。
 *
 * @param trades 原始交易记录。调用方负责传入已结构化、已校验的数据。
 * @param priceSnapshots 原始价格事实。没有可用快照时不生成价格派生字段。
 * @returns 按 assetSymbol 聚合后的当前仓位结果。
 */
export function calculatePositions(
  trades: Trade[],
  priceSnapshots: PriceSnapshot[] = [],
): Position[] {
  const positionsByAsset = new Map<string, PositionAccumulator>();

  for (const trade of sortTradesByOccurredAt(trades)) {
    const current = getOrCreatePosition(positionsByAsset, trade);

    if (trade.type === "buy") {
      applyBuy(current, trade);
      continue;
    }

    applySell(current, trade);
  }

  return Array.from(positionsByAsset.values()).map((position) =>
    toPosition(position, priceSnapshots),
  );
}

/**
 * 按交易发生时间排序。
 *
 * 同一天的交易保持原输入顺序，这是为了让样例数据和未来手动录入的顺序稳定。
 * JavaScript 的 sort 虽然现代运行时通常稳定，但这里保留 index 作为 tie-breaker，
 * 让规则显式写在代码里。
 */
function sortTradesByOccurredAt(trades: Trade[]): Trade[] {
  return trades
    .map((trade, index) => ({ trade, index }))
    .sort((left, right) => {
      const dateOrder = left.trade.occurredAt.localeCompare(right.trade.occurredAt);
      return dateOrder === 0 ? left.index - right.index : dateOrder;
    })
    .map(({ trade }) => trade);
}

/**
 * 取出某个资产当前的 accumulator；如果第一次遇到该资产，就初始化空仓位。
 *
 * 这里同时做一个轻量防御：同一个资产在 v1 里不能混用不同 currency。
 * 多币种换算以后会单独做，不应该偷偷混进 calculator v1。
 */
function getOrCreatePosition(
  positionsByAsset: Map<string, PositionAccumulator>,
  trade: Trade,
): PositionAccumulator {
  const existing = positionsByAsset.get(trade.assetSymbol);

  if (existing) {
    if (existing.currency !== trade.currency) {
      throw new Error(`Mixed currencies are not supported for ${trade.assetSymbol}`);
    }

    return existing;
  }

  const created: PositionAccumulator = {
    assetSymbol: trade.assetSymbol,
    quantity: "0",
    costBasis: "0",
    realizedPnl: "0",
    currency: trade.currency,
  };

  positionsByAsset.set(trade.assetSymbol, created);
  return created;
}

/**
 * 买入规则：
 * - 持仓数量增加 trade.quantity
 * - 成本基准增加 trade.totalValue
 *
 * 注意：这里故意不用 quantity * price 反推成本。
 * 真实成交会有四舍五入，所以 costBasis 以记录中的 totalValue 为准。
 */
function applyBuy(position: PositionAccumulator, trade: Trade): void {
  position.quantity = add(position.quantity, trade.quantity);
  position.costBasis = add(position.costBasis, trade.totalValue);
}

/**
 * 卖出规则：
 * - 先用卖出前平均成本计算 soldCostBasis
 * - 再减少 quantity / costBasis
 * - 最后累计 realizedPnl
 *
 * 公式：
 * soldCostBasis = sellQuantity * averageCostBeforeSell
 * realizedPnl = sellTotalValue - soldCostBasis
 */
function applySell(position: PositionAccumulator, trade: Trade): void {
  // 正式的超卖拦截以后会放在 tradeValidator；calculator 这里保留防御性检查。
  if (isGreaterThan(trade.quantity, position.quantity)) {
    throw new Error(`Cannot sell more ${trade.assetSymbol} than current position`);
  }

  if (isZero(position.quantity)) {
    throw new Error(`Cannot sell ${trade.assetSymbol} with zero current position`);
  }

  const averageCostBeforeSell = divide(position.costBasis, position.quantity);
  const soldCostBasis = multiply(trade.quantity, averageCostBeforeSell);

  // 卖出不会改变剩余仓位的平均成本口径，只是按原平均成本结转掉一部分成本。
  position.quantity = subtract(position.quantity, trade.quantity);
  position.costBasis = subtract(position.costBasis, soldCostBasis);
  position.realizedPnl = add(
    position.realizedPnl,
    subtract(trade.totalValue, soldCostBasis),
  );

  // 清仓后把极小残留成本归零，避免 Decimal 除法留下没有业务意义的 dust。
  if (isZero(position.quantity)) {
    position.costBasis = "0";
  }
}

/**
 * 把内部 accumulator 转成对外的 Position。
 *
 * 没有同资产、同币种的价格快照时，只返回交易可以推导出的字段。
 */
function toPosition(
  position: PositionAccumulator,
  priceSnapshots: PriceSnapshot[],
): Position {
  const result: Position = {
    assetSymbol: position.assetSymbol,
    quantity: position.quantity,
    averageCost: calculateAverageCost(position),
    costBasis: position.costBasis,
    realizedPnl: position.realizedPnl,
    currency: position.currency,
  };

  const latestSnapshot = findLatestSnapshot(position, priceSnapshots);

  if (!latestSnapshot) {
    return result;
  }

  const marketValue = multiply(position.quantity, latestSnapshot.price);

  return {
    ...result,
    latestPrice: latestSnapshot.price,
    marketValue,
    unrealizedPnl: subtract(marketValue, position.costBasis),
  };
}

/**
 * 只比较同资产、同币种的价格快照。
 *
 * recordedAt 较新的快照获胜；recordedAt 相同时，数组中后出现的快照获胜，
 * 这样后录入的同时间价格可以作为前一条的更正。
 */
function findLatestSnapshot(
  position: PositionAccumulator,
  priceSnapshots: PriceSnapshot[],
): PriceSnapshot | undefined {
  let latest: PriceSnapshot | undefined;

  for (const snapshot of priceSnapshots) {
    if (
      snapshot.assetSymbol !== position.assetSymbol ||
      snapshot.currency !== position.currency
    ) {
      continue;
    }

    if (!latest || snapshot.recordedAt.localeCompare(latest.recordedAt) >= 0) {
      latest = snapshot;
    }
  }

  return latest;
}

/**
 * 当前平均成本。
 *
 * 空仓位返回 "0"，避免除以 0。非空仓位用 costBasis / quantity。
 */
function calculateAverageCost(position: PositionAccumulator): DecimalString {
  if (isZero(position.quantity)) {
    return "0";
  }

  return toDecimalString(divide(position.costBasis, position.quantity));
}
