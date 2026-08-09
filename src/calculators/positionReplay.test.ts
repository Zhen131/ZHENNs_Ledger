import { describe, expect, it } from "vitest";

import type { Trade } from "../models";
import { replayPositions } from "./positionReplay";

const TIMESTAMP = "2026-08-09T00:00:00Z";

function trade(
  overrides: Pick<
    Trade,
    | "id"
    | "occurredAt"
    | "type"
    | "quantity"
    | "price"
    | "totalValue"
    | "fee"
  > &
    Partial<Pick<Trade, "feeCurrency" | "feeRuleId">>,
): Trade {
  return {
    timePrecision: "day",
    assetSymbol: "BTC",
    currency: "USDT",
    feeCurrency: overrides.feeCurrency ?? "USDT",
    createdAt: TIMESTAMP,
    updatedAt: TIMESTAMP,
    ...overrides,
  };
}

describe("fee-aware position replay", () => {
  it("matches the fixed 6500/5 and 2800/3 accounting example exactly", () => {
    const positions = replayPositions([
      trade({
        id: "buy",
        occurredAt: "2026-08-01",
        type: "buy",
        quantity: "0.1",
        price: "65000",
        totalValue: "6500",
        fee: "5",
      }),
      trade({
        id: "sell",
        occurredAt: "2026-08-02",
        type: "sell",
        quantity: "0.04",
        price: "70000",
        totalValue: "2800",
        fee: "3",
      }),
    ]);

    expect(positions).toEqual([
      expect.objectContaining({
        assetSymbol: "BTC",
        quantity: "0.06",
        averageCost: "65050",
        costBasis: "3903",
        realizedPnl: "195",
        currency: "USDT",
      }),
    ]);
  });

  it("includes every buy fee, removes average fee-aware cost, and deducts sell fees", () => {
    const positions = replayPositions([
      trade({
        id: "buy-1",
        occurredAt: "2026-08-01",
        type: "buy",
        quantity: "1",
        price: "100",
        totalValue: "100",
        fee: "1",
      }),
      trade({
        id: "buy-2",
        occurredAt: "2026-08-02",
        type: "buy",
        quantity: "1",
        price: "200",
        totalValue: "200",
        fee: "2",
      }),
      trade({
        id: "sell",
        occurredAt: "2026-08-03",
        type: "sell",
        quantity: "0.5",
        price: "200",
        totalValue: "100",
        fee: "1",
      }),
    ]);

    expect(positions[0]).toEqual(
      expect.objectContaining({
        quantity: "1.5",
        averageCost: "151.5",
        costBasis: "227.25",
        realizedPnl: "23.25",
      }),
    );
  });

  it("removes the entire remaining cost on the final sell without a decimal residue", () => {
    const positions = replayPositions([
      trade({
        id: "buy",
        occurredAt: "2026-08-01",
        type: "buy",
        quantity: "0.3",
        price: "0.3333333333333333333333333333333333333333",
        totalValue: "0.1",
        fee: "0.0000000000000000000000000000000000000001",
      }),
      trade({
        id: "partial",
        occurredAt: "2026-08-02",
        type: "sell",
        quantity: "0.1",
        price: "0.5",
        totalValue: "0.05",
        fee: "0.0000000000000000000000000000000000000001",
      }),
      trade({
        id: "final",
        occurredAt: "2026-08-03",
        type: "sell",
        quantity: "0.2",
        price: "0.5",
        totalValue: "0.1",
        fee: "0",
      }),
    ]);

    expect(positions[0].quantity).toBe("0");
    expect(positions[0].averageCost).toBe("0");
    expect(positions[0].costBasis).toBe("0");
  });

  it("keeps zero-fee behavior unchanged and never consults fee rules", () => {
    const positions = replayPositions([
      trade({
        id: "buy",
        occurredAt: "2026-08-01",
        type: "buy",
        quantity: "1",
        price: "100",
        totalValue: "100",
        fee: "0",
        feeCurrency: "BNB",
        feeRuleId: "ignored-rule",
      }),
    ]);

    expect(positions[0]).toEqual({
      assetSymbol: "BTC",
      quantity: "1",
      averageCost: "100",
      costBasis: "100",
      realizedPnl: "0",
      currency: "USDT",
    });
  });

  it("records a foreign non-zero fee issue without guessing a conversion", () => {
    const positions = replayPositions([
      trade({
        id: "foreign-fee",
        occurredAt: "2026-08-01",
        type: "buy",
        quantity: "1",
        price: "100",
        totalValue: "100",
        fee: "0.01",
        feeCurrency: "BNB",
      }),
    ]);

    expect(positions[0]).toEqual({
      assetSymbol: "BTC",
      quantity: "1",
      averageCost: "100",
      costBasis: "100",
      realizedPnl: "0",
      currency: "USDT",
      feeAccountingIssues: [
        {
          code: "UNSUPPORTED_FEE_CURRENCY",
          tradeId: "foreign-fee",
          assetSymbol: "BTC",
          occurredAt: "2026-08-01",
          fee: "0.01",
          feeCurrency: "BNB",
          tradeCurrency: "USDT",
        },
      ],
    });
  });

  it("does not mutate trades while replaying", () => {
    const trades = [
      trade({
        id: "immutable",
        occurredAt: "2026-08-01",
        type: "buy",
        quantity: "1",
        price: "100",
        totalValue: "100",
        fee: "1",
      }),
    ];
    const before = structuredClone(trades);

    replayPositions(trades);

    expect(trades).toEqual(before);
  });
});
