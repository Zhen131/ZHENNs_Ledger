/**
 * 这个文件管币的持仓：每种币剩多少、成本多少、盈亏多少。
 * 它把买卖和资产转移按顺序过一遍。
 * 它不管配价格算市值，那在 positionCalculator.ts；也不管 USDT 现金，那在 cashReplay.ts。
 * 不显然的决定：成本含手续费，全部卖清时成本直接清零。2026-08-09 定（W12 01A 第 5.3 节）。
 */

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
  compareLedgerFactOrder,
  divide,
  isEqual,
  isGreaterThan,
  isPositive,
  isZero,
  multiply,
  subtract,
  toDecimalString,
} from "@/core/shared";
import { type LedgerReplayCandidate } from "./cashReplay";
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

/**
 * 按顺序过到一半的状态：每种币当前的数量、成本、盈亏。
 * 只在这个文件的函数之间传。
 */
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

/** 排队过一遍的一笔：要么是一笔买卖，要么是一笔资产转移。 */
export type PositionReplayCandidate =
  | TradeReplayCandidate
  | AssetTransferReplayCandidate;

/**
 * 这个函数给出一个空的状态，还没有任何币。
 * 举例：刚创建 → 答一个空表。
 */
export function createPositionReplayState(): PositionReplayState {
  return { positionsByAsset: new Map() };
}

/**
 * 这个函数回答：买卖和资产转移放在一起，按什么顺序过？
 * 举例：8 月 1 日买入、8 月 3 日转到冷钱包 → 答买入在前。
 *
 * 为什么不看数组下标：两个列表的下标没法互相比。
 * 顺序统一用 compareLedgerFactOrder。2026-09-07 定（W16 03A 第二节 D-2c）。
 * 不会出错。
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
  ].sort((left, right) => compareLedgerFactOrder(left, right));
}

/**
 * 这个函数把一笔买卖记进过到一半的状态。
 * 数量、成本、已实现盈亏跟着变。
 * 买入：数量加上，成本加上「成交金额 + USDT 手续费」。
 * 卖出：按卖前的平均成本拿掉成本，差价记进已实现盈亏。
 * 举例：买 0.1 BTC 花 6505，再卖 0.04 BTC 收 2797。
 * → 答拿掉成本 2602，赚 195；剩 0.06 BTC，成本 3903。
 * 手续费用买卖的那个币付时，扣的是币。
 * 买入少到手，卖出多扣掉。
 *
 * 为什么这样算：2026-08-09 定的固定样例就是这组数（W12 01A 第 5.2、5.3 节）。
 *
 * 什么时候出错：卖的比手里多，或交易所里的不够，直接抛错。
 * 买入的手续费不比买到的数量少，也抛错。
 */
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

/**
 * 这个函数把一笔资产转移记进过到一半的状态。
 * 四种大类分别处理。
 * 内部挪动：只换地方；网络费按平均成本拿掉，记成亏损。
 * 转进：数量和成本都加上（数量乘单价）。
 * 转出：按平均成本拿掉，记成亏损。
 * 白得的收益：数量加上，按单价记成本，也记进白得收入。
 * 举例：持 0.06 BTC、成本 3903，转出 0.03 → 答成本剩 1951.5，亏损记 1951.5。
 *
 * 为什么网络费和转出要记成亏损：这是猜的，日志里没写，要核。
 *
 * 什么时候出错：转出的比手里多，或缺地点、缺单价，直接抛错。
 */
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

/**
 * 这个函数把过到一半的状态整理成持仓列表。
 * 顺便算出平均成本。
 * 举例：剩 0.06 BTC，成本 3903 → 答平均成本 65050。
 * 数量是 0 时平均成本答 0。不会出错。
 */
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

/**
 * 这个函数回答：每种币的持仓是什么？
 * 它把所有买卖和资产转移按顺序过一遍。
 * 举例：买 0.1 BTC 花 6505，卖 0.04 收 2797 → 答剩 0.06 BTC，成本 3903，已实现盈亏 195。
 * 过到某笔卖得比手里多时抛错，不给半成品。
 */
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

/**
 * 这个函数回答：已有持仓再接一笔买卖，持仓变成什么？
 * 不用从头再过一遍。
 * 举例：已有 0.1 BTC、成本 6505，再卖 0.04 收 2797 → 答剩 0.06 BTC、成本 3903。
 * 这笔的资产或币种和原持仓不一样时抛错；卖得比手里多也抛错。
 */
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
