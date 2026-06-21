import type { DecimalString, Position, Trade } from "../models";
import {
  add,
  divide,
  isGreaterThan,
  isZero,
  multiply,
  subtract,
  toDecimalString,
} from "../utils/decimalMath";

type PositionAccumulator = {
  assetSymbol: string;
  quantity: DecimalString;
  costBasis: DecimalString;
  realizedPnl: DecimalString;
  currency: string;
};

export function calculatePositions(trades: Trade[]): Position[] {
  const positionsByAsset = new Map<string, PositionAccumulator>();

  for (const trade of sortTradesByOccurredAt(trades)) {
    const current = getOrCreatePosition(positionsByAsset, trade);

    if (trade.type === "buy") {
      applyBuy(current, trade);
      continue;
    }

    applySell(current, trade);
  }

  return Array.from(positionsByAsset.values()).map(toPosition);
}

function sortTradesByOccurredAt(trades: Trade[]): Trade[] {
  return trades
    .map((trade, index) => ({ trade, index }))
    .sort((left, right) => {
      const dateOrder = left.trade.occurredAt.localeCompare(right.trade.occurredAt);
      return dateOrder === 0 ? left.index - right.index : dateOrder;
    })
    .map(({ trade }) => trade);
}

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

function applyBuy(position: PositionAccumulator, trade: Trade): void {
  position.quantity = add(position.quantity, trade.quantity);
  position.costBasis = add(position.costBasis, trade.totalValue);
}

function applySell(position: PositionAccumulator, trade: Trade): void {
  if (isGreaterThan(trade.quantity, position.quantity)) {
    throw new Error(`Cannot sell more ${trade.assetSymbol} than current position`);
  }

  if (isZero(position.quantity)) {
    throw new Error(`Cannot sell ${trade.assetSymbol} with zero current position`);
  }

  const averageCostBeforeSell = divide(position.costBasis, position.quantity);
  const soldCostBasis = multiply(trade.quantity, averageCostBeforeSell);

  position.quantity = subtract(position.quantity, trade.quantity);
  position.costBasis = subtract(position.costBasis, soldCostBasis);
  position.realizedPnl = add(
    position.realizedPnl,
    subtract(trade.totalValue, soldCostBasis),
  );

  if (isZero(position.quantity)) {
    position.costBasis = "0";
  }
}

function toPosition(position: PositionAccumulator): Position {
  return {
    assetSymbol: position.assetSymbol,
    quantity: position.quantity,
    averageCost: calculateAverageCost(position),
    costBasis: position.costBasis,
    realizedPnl: position.realizedPnl,
    currency: position.currency,
  };
}

function calculateAverageCost(position: PositionAccumulator): DecimalString {
  if (isZero(position.quantity)) {
    return "0";
  }

  return toDecimalString(divide(position.costBasis, position.quantity));
}
