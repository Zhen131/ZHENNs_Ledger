import type {
  DecimalString,
  FeeAccountingIssue,
  Position,
  Trade,
} from "@/core/models";
import {
  add,
  divide,
  isEqual,
  isGreaterThan,
  isPositive,
  isZero,
  multiply,
  subtract,
  toDecimalString,
} from "@/core/shared";
import { compareLedgerFactOrder } from "@/core/shared";
import { calculateTradeCashImpact } from "./tradeCashImpact";

type PositionAccumulator = {
  assetSymbol: string;
  quantity: DecimalString;
  costBasis: DecimalString;
  realizedPnl: DecimalString;
  currency: string;
  feeAccountingIssues: FeeAccountingIssue[];
};

export type PositionReplayState = {
  readonly positionsByAsset: Map<string, PositionAccumulator>;
};

export function createPositionReplayState(): PositionReplayState {
  return { positionsByAsset: new Map() };
}

export function sortTradesForReplay(
  trades: readonly Trade[],
): Trade[] {
  return trades
    .map((trade, index) => ({ trade, index }))
    .sort((left, right) =>
      compareLedgerFactOrder(
        left.trade.occurredAt,
        right.trade.occurredAt,
        left.index,
        right.index,
      ),
    )
    .map(({ trade }) => trade);
}

export function applyTradeToReplay(
  state: PositionReplayState,
  trade: Trade,
): void {
  const position = getOrCreatePosition(state.positionsByAsset, trade);
  const cashImpact = calculateTradeCashImpact(trade);
  if (!cashImpact.ok) {
    position.feeAccountingIssues.push(createFeeIssue(trade));
  }

  if (trade.type === "buy") {
    const acquiredQuantity = usesTradeAssetFee(trade)
      ? subtract(trade.quantity, trade.fee)
      : trade.quantity;
    if (!isPositive(acquiredQuantity)) {
      throw new Error(
        `A ${trade.assetSymbol} buy fee must be less than the bought quantity`,
      );
    }
    position.quantity = add(position.quantity, acquiredQuantity);
    position.costBasis = add(
      position.costBasis,
      cashImpact.ok ? cashImpact.amount : trade.totalValue,
    );
    return;
  }

  const consumedQuantity = usesTradeAssetFee(trade)
    ? add(trade.quantity, trade.fee)
    : trade.quantity;
  if (isGreaterThan(consumedQuantity, position.quantity)) {
    throw new Error(`Cannot sell more ${trade.assetSymbol} than current position`);
  }
  if (isZero(position.quantity)) {
    throw new Error(`Cannot sell ${trade.assetSymbol} with zero current position`);
  }

  const isFullSell = isEqual(consumedQuantity, position.quantity);
  const soldCostBasis = isFullSell
    ? position.costBasis
    : multiply(
        consumedQuantity,
        divide(position.costBasis, position.quantity),
      );
  const netProceeds = cashImpact.ok ? cashImpact.amount : trade.totalValue;
  position.quantity = isFullSell
    ? "0"
    : subtract(position.quantity, consumedQuantity);
  position.costBasis = isFullSell
    ? "0"
    : subtract(position.costBasis, soldCostBasis);
  position.realizedPnl = add(
    position.realizedPnl,
    subtract(netProceeds, soldCostBasis),
  );
}

function usesTradeAssetFee(
  trade: Pick<Trade, "assetSymbol" | "fee" | "feeCurrency">,
): boolean {
  return !isZero(trade.fee) && trade.feeCurrency === trade.assetSymbol;
}

export function getReplayPositions(
  state: PositionReplayState,
): Position[] {
  return Array.from(state.positionsByAsset.values()).map((position) => ({
    assetSymbol: position.assetSymbol,
    quantity: position.quantity,
    averageCost: isZero(position.quantity)
      ? "0"
      : toDecimalString(divide(position.costBasis, position.quantity)),
    costBasis: position.costBasis,
    realizedPnl: position.realizedPnl,
    currency: position.currency,
    ...(position.feeAccountingIssues.length === 0
      ? {}
      : { feeAccountingIssues: [...position.feeAccountingIssues] }),
  }));
}

export function replayPositions(trades: readonly Trade[]): Position[] {
  const state = createPositionReplayState();
  for (const trade of sortTradesForReplay(trades)) {
    applyTradeToReplay(state, trade);
  }
  return getReplayPositions(state);
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
    feeAccountingIssues: [],
  };
  positionsByAsset.set(trade.assetSymbol, created);
  return created;
}

function createFeeIssue(trade: Trade): FeeAccountingIssue {
  return {
    code: "UNSUPPORTED_FEE_CURRENCY",
    tradeId: trade.id,
    assetSymbol: trade.assetSymbol,
    occurredAt: trade.occurredAt,
    fee: trade.fee,
    feeCurrency: trade.feeCurrency,
    tradeCurrency: trade.currency,
  };
}
