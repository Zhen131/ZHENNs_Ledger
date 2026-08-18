import { describe, expect, it } from "vitest";

import { createInitialLedgerData } from "@/core/state";
import { createSimpleTrade } from "@/test-support";
import { projectLedgerCashMutation } from "./cashProjection";

describe("projectLedgerCashMutation", () => {
  it("projects additions and deletions without persisting a balance", () => {
    const current = createInitialLedgerData();
    current.cashEvents = [
      {
        id: "deposit",
        occurredAt: "2026-08-18",
        timePrecision: "day",
        type: "deposit",
        currency: "USDT",
        amount: "10",
        createdAt: "2026-08-18T08:00:00.000Z",
        updatedAt: "2026-08-18T08:00:00.000Z",
      },
    ];
    const trade = {
      ...createSimpleTrade("buy", "buy", "BTC", "1", "2026-08-18"),
      totalValue: "15",
      price: "15",
    };
    const withTrade = { ...current, trades: [trade] };

    expect(projectLedgerCashMutation(current, withTrade, "2026-08-18")).toEqual({
      currentBalance: "10",
      delta: "-15",
      nextBalance: "-5",
      deficit: "5",
      requiresNegativeBalanceConfirmation: true,
    });
    const deletedDeposit = { ...withTrade, cashEvents: [] };
    expect(
      projectLedgerCashMutation(withTrade, deletedDeposit, "2026-08-18"),
    ).toMatchObject({ delta: "-10", nextBalance: "-15", deficit: "15" });
    expect(current).not.toHaveProperty("cashBalance");
  });
});
