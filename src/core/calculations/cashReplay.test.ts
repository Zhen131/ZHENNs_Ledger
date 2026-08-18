import { describe, expect, it } from "vitest";

import type { CashEvent, LedgerData, Trade } from "@/core/models";
import { createInitialLedgerData } from "@/core/state";
import { createSimpleTrade } from "@/test-support";
import { replayUsdtCash } from "./cashReplay";
import { calculateTradeUsdtCashDelta } from "./tradeCashImpact";

const CREATED_AT = "2026-08-18T08:00:00.000Z";

describe("V3 deterministic USDT cash replay", () => {
  it("replays deposit, withdrawal, expense, and a fixed adjustment exactly", () => {
    const firstThree = [
      flow("deposit", "1000", "cash-deposit", "2026-08-01"),
      flow("withdrawal", "125.5", "cash-withdrawal", "2026-08-02"),
      flow("external-expense", "24.5", "cash-expense", "2026-08-03"),
    ];
    const beforeAdjustment = replay({ cashEvents: firstThree });
    expect(beforeAdjustment.effects.map((effect) => effect.delta)).toEqual([
      "1000",
      "-125.5",
      "-24.5",
    ]);
    expect(beforeAdjustment.balance).toBe("850");

    const adjustment = balanceAdjustment({
      id: "cash-adjustment",
      occurredAt: "2026-08-04",
      balanceBefore: "850",
      targetBalance: "800",
      adjustmentAmount: "-50",
    });
    const adjusted = replay({ cashEvents: [...firstThree, adjustment] });
    expect(adjusted.balance).toBe("800");
    expect(adjustment).toEqual(
      expect.objectContaining({
        balanceBefore: "850",
        targetBalance: "800",
        adjustmentAmount: "-50",
      }),
    );
  });

  it("keeps adjustment evidence fixed after an earlier fact is deleted", () => {
    const adjustment = balanceAdjustment({
      id: "adjust",
      occurredAt: "2026-08-03",
      balanceBefore: "90",
      targetBalance: "50",
      adjustmentAmount: "-40",
    });
    const ledger = makeLedger({
      cashEvents: [
        flow("deposit", "100", "deposit", "2026-08-01"),
        flow("withdrawal", "10", "withdrawal", "2026-08-02"),
        adjustment,
      ],
    });

    expect(replayUsdtCash(ledger).balance).toBe("50");
    ledger.cashEvents = ledger.cashEvents.filter(
      (event) => event.id !== "deposit",
    );
    expect(replayUsdtCash(ledger).balance).toBe("-50");
    expect(adjustment.adjustmentAmount).toBe("-40");
  });

  it("applies USDT fees once and ignores non-USDT fees for cash", () => {
    const usdtBuy = trade("usdt-buy", "buy", "100", "2", "USDT");
    const usdtSell = trade("usdt-sell", "sell", "60", "1", "USDT");
    const assetFeeBuy = trade("asset-buy", "buy", "100", "2", "ETH");
    const assetFeeSell = trade("asset-sell", "sell", "60", "1", "ETH");

    expect(calculateTradeUsdtCashDelta(usdtBuy)).toBe("-102");
    expect(calculateTradeUsdtCashDelta(usdtSell)).toBe("59");
    expect(calculateTradeUsdtCashDelta(assetFeeBuy)).toBe("-100");
    expect(calculateTradeUsdtCashDelta(assetFeeSell)).toBe("60");
    expect(replay({ trades: [usdtBuy, usdtSell] }).balance).toBe("-43");
  });

  it("removes only source facts and derives the new balance from survivors", () => {
    const ledger = makeLedger({
      trades: [
        trade("buy-a", "buy", "10", "0", "USDT", "2026-08-01"),
        trade("sell-b", "sell", "4", "0", "USDT", "2026-08-03"),
      ],
      cashEvents: [
        flow("deposit", "20", "deposit", "2026-08-02"),
        flow("external-expense", "3", "expense", "2026-08-04"),
      ],
    });
    expect(replayUsdtCash(ledger).balance).toBe("11");

    ledger.trades = ledger.trades.filter((item) => item.id !== "sell-b");
    expect(replayUsdtCash(ledger).balance).toBe("7");
    ledger.cashEvents = ledger.cashEvents.filter(
      (item) => item.id !== "expense",
    );
    expect(replayUsdtCash(ledger).balance).toBe("10");
  });

  it("sorts deterministically by occurrence, creation, kind, and id", () => {
    const occurredAt = "2026-08-05T10:00:00.000Z";
    const input = makeLedger({
      trades: [
        trade("trade-z", "buy", "1", "0", "USDT", occurredAt),
        trade("trade-a", "buy", "2", "0", "USDT", occurredAt),
      ],
      cashEvents: [
        flow("deposit", "4", "cash-z", occurredAt),
        flow("deposit", "8", "cash-a", occurredAt),
      ],
    });

    const first = replayUsdtCash(input);
    const second = replayUsdtCash({
      trades: [...input.trades].reverse(),
      cashEvents: [...input.cashEvents].reverse(),
    });
    expect(first.effects.map((effect) => effect.id)).toEqual([
      "trade-a",
      "trade-z",
      "cash-a",
      "cash-z",
    ]);
    expect(second).toEqual(first);
    expect(first.balance).toBe("9");
  });

  it("allows zero and negative balances and excludes facts after asOf", () => {
    const result = replay(
      {
        cashEvents: [
          flow("external-expense", "25", "expense", "2026-08-01"),
          flow("deposit", "25", "deposit", "2026-08-02"),
          flow("deposit", "10", "future", "2099-01-01"),
        ],
      },
      "2026-08-02",
    );

    expect(result.effects.map((effect) => effect.balanceAfter)).toEqual([
      "-25",
      "0",
    ]);
    expect(result.balance).toBe("0");
  });
});

function makeLedger(
  overrides: Partial<Pick<LedgerData, "trades" | "cashEvents">>,
): LedgerData {
  return { ...createInitialLedgerData(), ...overrides };
}

function replay(
  overrides: Partial<Pick<LedgerData, "trades" | "cashEvents">>,
  asOf?: string,
) {
  return replayUsdtCash(makeLedger(overrides), asOf ? { asOf } : {});
}

function flow(
  type: "deposit" | "withdrawal" | "external-expense",
  amount: string,
  id: string,
  occurredAt: string,
): CashEvent {
  return {
    id,
    occurredAt,
    timePrecision: occurredAt.includes("T") ? "second" : "day",
    type,
    amount,
    currency: "USDT",
    createdAt: CREATED_AT,
    updatedAt: CREATED_AT,
  };
}

function balanceAdjustment(
  input: Pick<
    Extract<CashEvent, { type: "balance-adjustment" }>,
    | "id"
    | "occurredAt"
    | "balanceBefore"
    | "targetBalance"
    | "adjustmentAmount"
  >,
): Extract<CashEvent, { type: "balance-adjustment" }> {
  return {
    ...input,
    timePrecision: input.occurredAt.includes("T") ? "second" : "day",
    type: "balance-adjustment",
    currency: "USDT",
    createdAt: CREATED_AT,
    updatedAt: CREATED_AT,
  };
}

function trade(
  id: string,
  type: "buy" | "sell",
  totalValue: string,
  fee: string,
  feeCurrency: string,
  occurredAt = "2026-08-01",
): Trade {
  return {
    ...createSimpleTrade(id, type, "BTC", "1", occurredAt),
    totalValue,
    price: totalValue,
    fee,
    feeCurrency,
    createdAt: CREATED_AT,
    updatedAt: CREATED_AT,
  };
}
