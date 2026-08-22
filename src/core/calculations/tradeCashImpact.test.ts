import { describe, expect, it } from "vitest";

import { calculateTradeCashImpact } from "./tradeCashImpact";

describe("trade cash impact", () => {
  it("keeps cash unchanged when the fee uses the traded asset", () => {
    expect(
      calculateTradeCashImpact({
        type: "buy",
        assetSymbol: "BTC",
        totalValue: "100",
        currency: "USDT",
        fee: "0.1",
        feeCurrency: "BTC",
      }),
    ).toEqual({
      ok: true,
      amount: "100",
      currency: "USDT",
      kind: "buy-outflow",
    });
    expect(
      calculateTradeCashImpact({
        type: "sell",
        assetSymbol: "BTC",
        totalValue: "60",
        currency: "USDT",
        fee: "0.05",
        feeCurrency: "BTC",
      }),
    ).toEqual({
      ok: true,
      amount: "60",
      currency: "USDT",
      kind: "sell-proceeds",
    });
  });

  it("keeps USDT fee behavior and rejects a third-asset fee", () => {
    expect(
      calculateTradeCashImpact({
        type: "buy",
        assetSymbol: "BTC",
        totalValue: "100",
        currency: "USDT",
        fee: "2",
        feeCurrency: "USDT",
      }),
    ).toEqual({
      ok: true,
      amount: "102",
      currency: "USDT",
      kind: "buy-outflow",
    });
    expect(
      calculateTradeCashImpact({
        type: "buy",
        assetSymbol: "BTC",
        totalValue: "100",
        currency: "USDT",
        fee: "0.1",
        feeCurrency: "BNB",
      }),
    ).toEqual({
      ok: false,
      reason: "UNSUPPORTED_FEE_CURRENCY",
      feeCurrency: "BNB",
      tradeCurrency: "USDT",
    });
  });
});
