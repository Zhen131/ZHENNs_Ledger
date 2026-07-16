import { describe, expect, it } from "vitest";

import { getPositionsFromLedger } from "./positionService";
import { createInitialLedgerData } from "../state/initialLedgerData";
import { sampleTrades } from "../test/fixtures";
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
});
