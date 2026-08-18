import type {
  CashEvent,
  DecimalString,
  LedgerData,
  Trade,
} from "@/core/models";
import { add, getLedgerDateKey } from "@/core/shared";
import { calculateTradeUsdtCashDelta } from "./tradeCashImpact";

export type UsdtCashReplayEffect = Readonly<{
  id: string;
  kind: "trade" | "cash-event";
  occurredAt: string;
  createdAt: string;
  delta: DecimalString;
  balanceAfter: DecimalString;
}>;

export type UsdtCashReplayResult = Readonly<{
  balance: DecimalString;
  effects: readonly UsdtCashReplayEffect[];
}>;

export type UsdtCashReplayOptions = Readonly<{
  asOf?: string;
}>;

type CashReplayCandidate = Omit<UsdtCashReplayEffect, "balanceAfter">;

export function replayUsdtCash(
  ledgerData: Pick<LedgerData, "trades" | "cashEvents">,
  options: UsdtCashReplayOptions = {},
): UsdtCashReplayResult {
  const asOf = options.asOf ? getLedgerDateKey(options.asOf) : undefined;
  const candidates = [
    ...ledgerData.trades.map(projectTrade),
    ...ledgerData.cashEvents.map(projectCashEvent),
  ]
    .filter(
      (candidate) =>
        asOf === undefined || getLedgerDateKey(candidate.occurredAt) <= asOf,
    )
    .sort(compareCashReplayCandidates);

  let balance: DecimalString = "0";
  const effects = candidates.map((candidate) => {
    balance = add(balance, candidate.delta);
    return { ...candidate, balanceAfter: balance };
  });

  return { balance, effects };
}

function projectTrade(trade: Trade): CashReplayCandidate {
  return {
    id: trade.id,
    kind: "trade",
    occurredAt: trade.occurredAt,
    createdAt: trade.createdAt,
    delta: calculateTradeUsdtCashDelta(trade),
  };
}

function projectCashEvent(cashEvent: CashEvent): CashReplayCandidate {
  return {
    id: cashEvent.id,
    kind: "cash-event",
    occurredAt: cashEvent.occurredAt,
    createdAt: cashEvent.createdAt,
    delta: cashEventDelta(cashEvent),
  };
}

function cashEventDelta(cashEvent: CashEvent): DecimalString {
  switch (cashEvent.type) {
    case "deposit":
      return cashEvent.amount;
    case "withdrawal":
    case "external-expense":
      return cashEvent.amount === "0" ? "0" : `-${cashEvent.amount}`;
    case "balance-adjustment":
      return cashEvent.adjustmentAmount;
  }
}

function compareCashReplayCandidates(
  left: CashReplayCandidate,
  right: CashReplayCandidate,
): number {
  const leftDate = getLedgerDateKey(left.occurredAt);
  const rightDate = getLedgerDateKey(right.occurredAt);
  if (leftDate !== rightDate) {
    return leftDate.localeCompare(rightDate);
  }

  if (left.occurredAt.length > 10 && right.occurredAt.length > 10) {
    const instantOrder = Date.parse(left.occurredAt) - Date.parse(right.occurredAt);
    if (instantOrder !== 0) {
      return instantOrder;
    }
  }

  const createdAtOrder = Date.parse(left.createdAt) - Date.parse(right.createdAt);
  if (createdAtOrder !== 0) {
    return createdAtOrder;
  }
  if (left.kind !== right.kind) {
    return left.kind === "trade" ? -1 : 1;
  }
  return left.id.localeCompare(right.id, "en");
}
