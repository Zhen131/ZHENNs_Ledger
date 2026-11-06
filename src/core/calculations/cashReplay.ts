/**
 * 这个文件管 USDT 现金还剩多少。
 * 它把记录从第一笔到最后一笔按顺序过一遍。
 * 它不管一笔买卖动多少钱，那在 tradeCashImpact.ts；也不管币的持仓，那在 positionReplay.ts。
 * 不显然的决定：现金余额永远现算，不存进账本。2026-08-19 定（W14 01B 第 3.4 节）。
 */

import type {
  CashEvent,
  DecimalString,
  LedgerData,
  Trade,
} from "@/core/models";
import {
  add,
  compareLedgerFactOrder,
  getLedgerDateKey,
} from "@/core/shared";
import { calculateTradeUsdtCashDelta } from "./tradeCashImpact";

/**
 * 过一遍时一笔记录对现金的影响。
 * 记的是变了多少、变完以后剩多少。
 */
export type UsdtCashReplayEffect = Readonly<{
  id: string;
  kind: "trade" | "cash-event";
  occurredAt: string;
  createdAt: string;
  delta: DecimalString;
  balanceAfter: DecimalString;
}>;

/** 过完所有记录的结果：最后剩多少，和每一笔的影响明细。 */
export type UsdtCashReplayResult = Readonly<{
  balance: DecimalString;
  effects: readonly UsdtCashReplayEffect[];
}>;

/** 只算到哪一天为止。不填就算全部。 */
export type UsdtCashReplayOptions = Readonly<{
  asOf?: string;
}>;

/**
 * 排队过一遍时，每一笔要带的几样。
 * 有编号、种类、时间、录入时间。
 */
export type LedgerReplayCandidate = Readonly<{
  id: string;
  kind: "trade" | "cash-event" | "asset-transfer";
  occurredAt: string;
  createdAt: string;
}>;

type CashReplayCandidate = Omit<UsdtCashReplayEffect, "balanceAfter">;

/**
 * 这个函数回答：USDT 现金还剩多少？
 * 它把买卖和现金记录按顺序过一遍。
 * 它也给出每一笔之后的余额。
 * 填了截止日，就只算那天和那天以前的记录。
 * 举例：入金 10000，买 0.1 BTC 花 6505，卖 0.04 BTC 收 2797 → 答余额 6292。
 *
 * 为什么从 0 开始、余额不存：余额永远从剩下的记录现算。
 * 删掉一笔，所有页面马上跟着变。2026-08-19 定（W14 01B 第 3.4 节）。
 * 截止日里有不是日期开头的值时会抛错。
 */
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
    .sort((left, right) => compareLedgerFactOrder(left, right));

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
    delta: calculateCashEventUsdtDelta(cashEvent),
  };
}

/**
 * 这个函数回答：一条现金记录让 USDT 现金变了多少？
 * 入金是正数；出金和外部支出是负数；余额校准就是存下的差额。
 * 举例：出金 300 → 答 "-300"；校准前 100、目标 80 → 答 "-20"。
 *
 * 为什么校准只加差额：删掉早期记录时，校准不该跟着变。
 * 2026-08-19 定（W14 01B 第 3.2 节）。
 * 不会出错。
 */
export function calculateCashEventUsdtDelta(
  cashEvent: CashEvent,
): DecimalString {
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
