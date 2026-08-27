import { describe, expect, it } from "vitest";

import { getPositionsFromLedger } from "@/features/portfolio";
import { createInitialLedgerData } from "@/core/state";
import { sampleTrades } from "@/test-support";
import {
  TRADE_REMOVAL_ERROR_CODES,
  validateTradeRemoval,
} from "./tradeRemovalService";

function createSampleLedger() {
  return {
    ...createInitialLedgerData(),
    trades: structuredClone(sampleTrades),
  };
}

describe("validateTradeRemoval", () => {
  it("allows deleting a trade when the remaining timeline stays valid", () => {
    const ledgerData = createSampleLedger();
    const result = validateTradeRemoval("trade-005", ledgerData);

    expect(result).toEqual({ ok: true, tradeId: "trade-005" });
    expect(ledgerData.trades).toEqual(sampleTrades);
  });

  it("blocks deleting a buy that supports a later sell", () => {
    const ledgerData = createSampleLedger();
    const result = validateTradeRemoval("trade-004", ledgerData);

    expect(result).toEqual({
      ok: false,
      error: {
        code: TRADE_REMOVAL_ERROR_CODES.BREAKS_LEDGER_TIMELINE,
        message: expect.any(String),
      },
    });
    expect(() => {
      getPositionsFromLedger({
        ...ledgerData,
        trades: ledgerData.trades.filter((trade) => trade.id !== "trade-004"),
      });
    }).toThrow(/Cannot sell more ADA/);
    expect(ledgerData.trades).toEqual(sampleTrades);
  });

  it("reports a missing trade without changing the ledger", () => {
    const ledgerData = createSampleLedger();

    expect(validateTradeRemoval("missing-trade", ledgerData)).toEqual({
      ok: false,
      error: {
        code: TRADE_REMOVAL_ERROR_CODES.NOT_FOUND,
        message: expect.any(String),
      },
    });
    expect(ledgerData.trades).toEqual(sampleTrades);
  });

  it("blocks deleting a future buy that supports a later future sell", () => {
    const ledgerData = createInitialLedgerData();
    ledgerData.trades = [
      {
        ...sampleTrades[0],
        id: "future-buy",
        occurredAt: "2099-01-01",
        type: "buy",
        assetSymbol: "BTC",
        quantity: "1",
        price: "100",
        totalValue: "100",
      },
      {
        ...sampleTrades[0],
        id: "future-sell",
        occurredAt: "2099-01-02",
        type: "sell",
        assetSymbol: "BTC",
        quantity: "1",
        price: "110",
        totalValue: "110",
      },
    ];

    expect(validateTradeRemoval("future-buy", ledgerData)).toEqual({
      ok: false,
      error: {
        code: TRADE_REMOVAL_ERROR_CODES.BREAKS_LEDGER_TIMELINE,
        message: expect.any(String),
      },
    });
    expect(validateTradeRemoval("future-sell", ledgerData)).toEqual({
      ok: true,
      tradeId: "future-sell",
    });
  });

  it("replays transfers when deciding whether a trade can be deleted", () => {
    const ledgerData = createInitialLedgerData();
    ledgerData.assetTransfers = [
      {
        id: "external-in-support",
        occurredAt: "2026-04-01",
        timePrecision: "day",
        assetSymbol: "BTC",
        quantity: "10",
        category: "external-in",
        reason: "deposit",
        unitPrice: "1",
        toLocation: "exchange",
        createdAt: "2026-08-01T00:00:00.000Z",
        updatedAt: "2026-08-01T00:00:00.000Z",
      },
    ];
    ledgerData.trades = [
      {
        ...sampleTrades[0],
        id: "redundant-buy",
        occurredAt: "2026-04-02",
        assetSymbol: "BTC",
        type: "buy",
        quantity: "5",
        price: "1",
        totalValue: "5",
      },
      {
        ...sampleTrades[0],
        id: "later-sell",
        occurredAt: "2026-04-03",
        assetSymbol: "BTC",
        type: "sell",
        quantity: "10",
        price: "1",
        totalValue: "10",
      },
    ];

    expect(validateTradeRemoval("redundant-buy", ledgerData)).toEqual({
      ok: true,
      tradeId: "redundant-buy",
    });
  });

  it("blocks deleting a buy that an external-out transfer consumes", () => {
    const ledgerData = createInitialLedgerData();
    ledgerData.trades = [
      {
        ...sampleTrades[0],
        id: "supporting-buy",
        occurredAt: "2026-04-01",
        assetSymbol: "BTC",
        type: "buy",
        quantity: "10",
        price: "1",
        totalValue: "10",
      },
    ];
    ledgerData.assetTransfers = [
      {
        id: "external-out-consumer",
        occurredAt: "2026-04-02",
        timePrecision: "day",
        assetSymbol: "BTC",
        quantity: "10",
        category: "external-out",
        reason: "withdrawal",
        fromLocation: "exchange",
        createdAt: "2026-08-01T00:00:00.000Z",
        updatedAt: "2026-08-01T00:00:00.000Z",
      },
    ];

    expect(validateTradeRemoval("supporting-buy", ledgerData)).toEqual({
      ok: false,
      error: {
        code: TRADE_REMOVAL_ERROR_CODES.BREAKS_LEDGER_TIMELINE,
        message: expect.any(String),
      },
    });
  });
});
