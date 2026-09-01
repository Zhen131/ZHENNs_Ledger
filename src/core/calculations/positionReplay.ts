import type {
  AssetTransfer,
  CurrencyCode,
  CustodyLocation,
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
import {
  compareCashReplayCandidates,
  type LedgerReplayCandidate,
} from "./cashReplay";
import { calculateTradeCashImpact } from "./tradeCashImpact";

const CUSTODY_LOCATIONS = [
  "exchange",
  "cold-wallet",
  "cold-wallet-earn",
] as const satisfies readonly CustodyLocation[];

type MutableLocationQuantities = Record<CustodyLocation, DecimalString>;

type PositionAccumulator = {
  assetSymbol: string;
  quantity: DecimalString;
  locationQuantities: MutableLocationQuantities;
  costBasis: DecimalString;
  realizedPnl: DecimalString;
  giftIncome: DecimalString;
  currency: CurrencyCode;
  feeAccountingIssues: FeeAccountingIssue[];
};

export type PositionReplayState = {
  readonly positionsByAsset: Map<string, PositionAccumulator>;
};

type TradeReplayCandidate = LedgerReplayCandidate & Readonly<{
  kind: "trade";
  fact: Trade;
}>;

type AssetTransferReplayCandidate = LedgerReplayCandidate & Readonly<{
  kind: "asset-transfer";
  fact: AssetTransfer;
}>;

export type PositionReplayCandidate =
  | TradeReplayCandidate
  | AssetTransferReplayCandidate;

export function createPositionReplayState(): PositionReplayState {
  return { positionsByAsset: new Map() };
}

/**
 * Trades and asset transfers are projected into one deterministic replay
 * timeline. Array indexes are deliberately excluded because indexes from two
 * independent collections are not comparable facts.
 */
export function sortPositionFactsForReplay(
  trades: readonly Trade[],
  assetTransfers: readonly AssetTransfer[],
): PositionReplayCandidate[] {
  return [
    ...trades.map(
      (fact): TradeReplayCandidate => ({
        id: fact.id,
        kind: "trade",
        occurredAt: fact.occurredAt,
        createdAt: fact.createdAt,
        fact,
      }),
    ),
    ...assetTransfers.map(
      (fact): AssetTransferReplayCandidate => ({
        id: fact.id,
        kind: "asset-transfer",
        occurredAt: fact.occurredAt,
        createdAt: fact.createdAt,
        fact,
      }),
    ),
  ].sort(compareCashReplayCandidates);
}

/** @deprecated Prefer sortPositionFactsForReplay for position accounting. */
export function sortTradesForReplay(trades: readonly Trade[]): Trade[] {
  return sortPositionFactsForReplay(trades, []).map(
    (candidate) => candidate.fact as Trade,
  );
}

export function applyTradeToReplay(
  state: PositionReplayState,
  trade: Trade,
): void {
  const position = getOrCreatePosition(
    state.positionsByAsset,
    trade.assetSymbol,
    trade.currency,
  );
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
    addLocationQuantity(position, "exchange", acquiredQuantity);
    position.costBasis = add(
      position.costBasis,
      cashImpact.ok ? cashImpact.amount : trade.totalValue,
    );
    return;
  }

  const consumedQuantity = usesTradeAssetFee(trade)
    ? add(trade.quantity, trade.fee)
    : trade.quantity;
  assertTotalQuantityAvailable(position, consumedQuantity, "sell");
  assertLocationQuantityAvailable(
    position,
    "exchange",
    consumedQuantity,
    "sell",
  );

  const soldCostBasis = calculateConsumedCostBasis(
    position,
    consumedQuantity,
  );
  const netProceeds = cashImpact.ok ? cashImpact.amount : trade.totalValue;
  consumeTotalQuantity(position, consumedQuantity, soldCostBasis);
  subtractLocationQuantity(position, "exchange", consumedQuantity);
  position.realizedPnl = add(
    position.realizedPnl,
    subtract(netProceeds, soldCostBasis),
  );
}

export function applyAssetTransferToReplay(
  state: PositionReplayState,
  transfer: AssetTransfer,
): void {
  const position = getOrCreatePosition(
    state.positionsByAsset,
    transfer.assetSymbol,
    "USDT",
  );
  const networkFee = transfer.networkFee ?? "0";

  switch (transfer.category) {
    case "internal": {
      const fromLocation = requireLocation(
        transfer.fromLocation,
        transfer,
        "fromLocation",
      );
      const toLocation = requireLocation(
        transfer.toLocation,
        transfer,
        "toLocation",
      );
      const sourceConsumption = add(transfer.quantity, networkFee);
      assertTotalQuantityAvailable(position, sourceConsumption, "transfer");
      assertLocationQuantityAvailable(
        position,
        fromLocation,
        sourceConsumption,
        "transfer",
      );

      if (!isZero(networkFee)) {
        const feeCostBasis = calculateConsumedCostBasis(position, networkFee);
        consumeTotalQuantity(position, networkFee, feeCostBasis);
        position.realizedPnl = subtract(position.realizedPnl, feeCostBasis);
      }
      subtractLocationQuantity(position, fromLocation, sourceConsumption);
      addLocationQuantity(position, toLocation, transfer.quantity);
      return;
    }

    case "external-in": {
      const toLocation = requireLocation(
        transfer.toLocation,
        transfer,
        "toLocation",
      );
      const unitPrice = requireUnitPrice(transfer);
      const acquiredCost = multiply(transfer.quantity, unitPrice);
      position.quantity = add(position.quantity, transfer.quantity);
      position.costBasis = add(position.costBasis, acquiredCost);
      addLocationQuantity(position, toLocation, transfer.quantity);
      return;
    }

    case "external-out": {
      const fromLocation = requireLocation(
        transfer.fromLocation,
        transfer,
        "fromLocation",
      );
      const sourceConsumption = add(transfer.quantity, networkFee);
      assertTotalQuantityAvailable(position, sourceConsumption, "transfer");
      assertLocationQuantityAvailable(
        position,
        fromLocation,
        sourceConsumption,
        "transfer",
      );
      const consumedCostBasis = calculateConsumedCostBasis(
        position,
        sourceConsumption,
      );
      consumeTotalQuantity(position, sourceConsumption, consumedCostBasis);
      subtractLocationQuantity(position, fromLocation, sourceConsumption);
      position.realizedPnl = subtract(
        position.realizedPnl,
        consumedCostBasis,
      );
      return;
    }

    case "gain": {
      const toLocation = requireLocation(
        transfer.toLocation,
        transfer,
        "toLocation",
      );
      const unitPrice = requireUnitPrice(transfer);
      const giftValue = multiply(transfer.quantity, unitPrice);
      position.quantity = add(position.quantity, transfer.quantity);
      position.costBasis = add(position.costBasis, giftValue);
      position.giftIncome = add(position.giftIncome, giftValue);
      addLocationQuantity(position, toLocation, transfer.quantity);
    }
  }
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
    locationQuantities: {
      exchange: position.locationQuantities.exchange,
      "cold-wallet": position.locationQuantities["cold-wallet"],
      "cold-wallet-earn": position.locationQuantities["cold-wallet-earn"],
    },
    averageCost: isZero(position.quantity)
      ? "0"
      : toDecimalString(divide(position.costBasis, position.quantity)),
    costBasis: position.costBasis,
    realizedPnl: position.realizedPnl,
    giftIncome: position.giftIncome,
    currency: position.currency,
    ...(position.feeAccountingIssues.length === 0
      ? {}
      : { feeAccountingIssues: [...position.feeAccountingIssues] }),
  }));
}

export function replayPositions(
  trades: readonly Trade[],
  assetTransfers: readonly AssetTransfer[] = [],
): Position[] {
  const state = createPositionReplayState();
  for (const candidate of sortPositionFactsForReplay(trades, assetTransfers)) {
    if (candidate.kind === "trade") {
      applyTradeToReplay(state, candidate.fact);
    } else {
      applyAssetTransferToReplay(state, candidate.fact);
    }
  }
  return getReplayPositions(state);
}

export function updatePositionForAppendedTrade(
  previous: Position,
  trade: Trade,
): Position {
  if (
    previous.assetSymbol !== trade.assetSymbol ||
    previous.currency !== trade.currency
  ) {
    throw new Error("An appended trade must match the previous position");
  }
  const state = createPositionReplayState();
  state.positionsByAsset.set(previous.assetSymbol, {
    assetSymbol: previous.assetSymbol,
    quantity: previous.quantity,
    locationQuantities: {
      exchange: previous.locationQuantities.exchange,
      "cold-wallet": previous.locationQuantities["cold-wallet"],
      "cold-wallet-earn": previous.locationQuantities["cold-wallet-earn"],
    },
    costBasis: previous.costBasis,
    realizedPnl: previous.realizedPnl,
    giftIncome: previous.giftIncome,
    currency: previous.currency,
    feeAccountingIssues: [...(previous.feeAccountingIssues ?? [])],
  });
  applyTradeToReplay(state, trade);
  return getReplayPositions(state)[0]!;
}

function getOrCreatePosition(
  positionsByAsset: Map<string, PositionAccumulator>,
  assetSymbol: string,
  currency: CurrencyCode,
): PositionAccumulator {
  const existing = positionsByAsset.get(assetSymbol);
  if (existing) {
    if (existing.currency !== currency) {
      throw new Error(`Mixed currencies are not supported for ${assetSymbol}`);
    }
    return existing;
  }

  const created: PositionAccumulator = {
    assetSymbol,
    quantity: "0",
    locationQuantities: createZeroLocationQuantities(),
    costBasis: "0",
    realizedPnl: "0",
    giftIncome: "0",
    currency,
    feeAccountingIssues: [],
  };
  positionsByAsset.set(assetSymbol, created);
  return created;
}

function createZeroLocationQuantities(): MutableLocationQuantities {
  return {
    exchange: "0",
    "cold-wallet": "0",
    "cold-wallet-earn": "0",
  };
}

function addLocationQuantity(
  position: PositionAccumulator,
  location: CustodyLocation,
  quantity: DecimalString,
): void {
  position.locationQuantities[location] = add(
    position.locationQuantities[location],
    quantity,
  );
}

function subtractLocationQuantity(
  position: PositionAccumulator,
  location: CustodyLocation,
  quantity: DecimalString,
): void {
  const current = position.locationQuantities[location];
  position.locationQuantities[location] = isEqual(current, quantity)
    ? "0"
    : subtract(current, quantity);
}

function assertTotalQuantityAvailable(
  position: PositionAccumulator,
  quantity: DecimalString,
  operation: "sell" | "transfer",
): void {
  if (isGreaterThan(quantity, position.quantity)) {
    throw new Error(
      operation === "sell"
        ? `Cannot sell more ${position.assetSymbol} than current position`
        : `Cannot transfer more ${position.assetSymbol} than current position`,
    );
  }
  if (isZero(position.quantity)) {
    throw new Error(
      operation === "sell"
        ? `Cannot sell ${position.assetSymbol} with zero current position`
        : `Cannot transfer ${position.assetSymbol} with zero current position`,
    );
  }
}

function assertLocationQuantityAvailable(
  position: PositionAccumulator,
  location: CustodyLocation,
  quantity: DecimalString,
  operation: "sell" | "transfer",
): void {
  if (isGreaterThan(quantity, position.locationQuantities[location])) {
    throw new Error(
      operation === "sell"
        ? `Cannot sell more ${position.assetSymbol} from exchange than available`
        : `Cannot transfer more ${position.assetSymbol} from ${location} than available`,
    );
  }
}

function calculateConsumedCostBasis(
  position: PositionAccumulator,
  consumedQuantity: DecimalString,
): DecimalString {
  if (isZero(consumedQuantity)) return "0";
  if (isZero(position.quantity)) {
    throw new Error(`Cannot consume ${position.assetSymbol} with zero position`);
  }
  return isEqual(consumedQuantity, position.quantity)
    ? position.costBasis
    : multiply(
        consumedQuantity,
        divide(position.costBasis, position.quantity),
      );
}

function consumeTotalQuantity(
  position: PositionAccumulator,
  consumedQuantity: DecimalString,
  consumedCostBasis: DecimalString,
): void {
  const fullyConsumed = isEqual(consumedQuantity, position.quantity);
  position.quantity = fullyConsumed
    ? "0"
    : subtract(position.quantity, consumedQuantity);
  position.costBasis = fullyConsumed
    ? "0"
    : subtract(position.costBasis, consumedCostBasis);
}

function requireLocation(
  location: CustodyLocation | undefined,
  transfer: AssetTransfer,
  field: "fromLocation" | "toLocation",
): CustodyLocation {
  if (location !== undefined && CUSTODY_LOCATIONS.includes(location)) {
    return location;
  }
  throw new Error(`${transfer.category} requires ${field}`);
}

function requireUnitPrice(transfer: AssetTransfer): DecimalString {
  if (transfer.unitPrice !== undefined) return transfer.unitPrice;
  throw new Error(`${transfer.category} requires unitPrice`);
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
