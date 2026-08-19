import { describe, expect, it } from "vitest";

import type { CashEvent, Trade } from "@/core/models";
import { createInitialLedgerData } from "@/core/state";
import { createUsdtSimpleTrade } from "@/test-support";
import {
  buildLedgerActivityItems,
  filterLedgerActivityItems,
} from "./activityService";

describe("ledger activity projection", () => {
  it("sorts stably by occurredAt, createdAt, trade before cash, then id", () => {
    const ledger = createInitialLedgerData();
    const shared = {
      occurredAt: "2026-08-19T12:00:00Z",
      createdAt: "2026-08-19T12:01:00Z",
      updatedAt: "2026-08-19T12:01:00Z",
    };
    ledger.trades = [
      trade("trade-b", shared),
      trade("trade-a", shared),
    ];
    ledger.cashEvents = [
      deposit("cash-b", shared),
      deposit("cash-a", shared),
    ];

    const first = buildLedgerActivityItems(ledger).map(
      (item) => `${item.kind}:${item.id}`,
    );
    ledger.trades.reverse();
    ledger.cashEvents.reverse();
    const second = buildLedgerActivityItems(ledger).map(
      (item) => `${item.kind}:${item.id}`,
    );

    expect(first).toEqual([
      "cash-event:cash-b",
      "cash-event:cash-a",
      "trade:trade-b",
      "trade:trade-a",
    ]);
    expect(second).toEqual(first);
  });

  it("intersects type, date, and asset filters with USDT matching cash only", () => {
    const ledger = createInitialLedgerData();
    ledger.trades = [
      createUsdtSimpleTrade("sol-buy", "buy", "SOL", "1", "2026-08-18"),
      createUsdtSimpleTrade("btc-sell", "sell", "BTC", "1", "2026-08-19"),
    ];
    ledger.cashEvents = [
      deposit("cash", {
        occurredAt: "2026-08-19",
        createdAt: "2026-08-19T01:00:00Z",
        updatedAt: "2026-08-19T01:00:00Z",
      }),
    ];
    const items = buildLedgerActivityItems(ledger);

    expect(
      filterLedgerActivityItems(items, {
        asset: "SOL",
        type: "buy",
        earliestDate: "2026-08-18",
        latestDate: "2026-08-19",
      }).map((item) => item.id),
    ).toEqual(["sol-buy"]);
    expect(
      filterLedgerActivityItems(items, { asset: "USDT" }).map(
        (item) => item.id,
      ),
    ).toEqual(["cash"]);
    expect(
      filterLedgerActivityItems(items, { asset: "USDT", type: "buy" }),
    ).toEqual([]);
  });
});

function trade(
  id: string,
  time: Pick<Trade, "occurredAt" | "createdAt" | "updatedAt">,
): Trade {
  return {
    ...createUsdtSimpleTrade(id, "buy", "BTC", "1", time.occurredAt),
    ...time,
  };
}

function deposit(
  id: string,
  time: Pick<CashEvent, "occurredAt" | "createdAt" | "updatedAt">,
): CashEvent {
  return {
    id,
    ...time,
    timePrecision: time.occurredAt.length === 10 ? "day" : "second",
    type: "deposit",
    currency: "USDT",
    amount: "1",
  };
}
