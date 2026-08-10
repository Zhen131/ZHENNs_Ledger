import { describe, expect, it } from "vitest";

import type { FeeRule } from "../models";
import {
  calculateFeeRuleCandidate,
  matchFeeRules,
} from "./feeRuleService";

const fixed: FeeRule = {
  id: "fee-okx-btc-v1",
  name: "OKX BTC fixed",
  platform: "OKX",
  assetSymbol: "BTC",
  status: "active",
  type: "fixed",
  amount: "5",
  currency: "USDT",
  createdAt: "2026-08-10T00:00:00.000Z",
  updatedAt: "2026-08-10T00:00:00.000Z",
};

const percentage: FeeRule = {
  id: "fee-binance-btc-v1",
  name: "Binance BTC percentage",
  platform: "Binance",
  assetSymbol: "BTC",
  status: "active",
  type: "percentage",
  rate: "0.001",
  currency: "USDT",
  createdAt: "2026-08-10T00:00:00.000Z",
  updatedAt: "2026-08-10T00:00:00.000Z",
};

describe("feeRuleService", () => {
  it("returns the fixed USDT amount without using totalValue", () => {
    expect(calculateFeeRuleCandidate(fixed, "6500")).toMatchObject({
      fee: "5",
      currency: "USDT",
      formula: "5 USDT fixed",
    });
  });

  it("uses 40-digit decimal multiplication without implicit rounding", () => {
    expect(calculateFeeRuleCandidate(percentage, "6500")).toMatchObject({
      fee: "6.5",
      currency: "USDT",
      formula: "6500 × 0.001",
    });
    expect(
      calculateFeeRuleCandidate(
        { ...percentage, rate: "0.3333333333333333333333333333333333333333" },
        "3",
      ).fee,
    ).toBe("0.9999999999999999999999999999999999999999");
  });

  it("matches only exact active platform and asset values", () => {
    expect(
      matchFeeRules(
        { platform: "Binance", assetSymbol: "BTC", totalValue: "6500" },
        [fixed, percentage],
      ),
    ).toMatchObject({ status: "matched", candidate: { fee: "6.5" } });
    for (const platform of [undefined, "", "binance", " Binance", "Bin"] as const) {
      expect(
        matchFeeRules(
          { platform, assetSymbol: "BTC", totalValue: "6500" },
          [percentage],
        ).status,
      ).not.toBe("matched");
    }
    expect(
      matchFeeRules(
        { platform: "Binance", assetSymbol: "ETH", totalValue: "6500" },
        [percentage],
      ),
    ).toEqual({ status: "no-match" });
    expect(
      matchFeeRules(
        { platform: "Binance", assetSymbol: "BTC", totalValue: "6500" },
        [{ ...percentage, status: "inactive", deactivatedAt: "2026-08-10T01:00:00.000Z" }],
      ),
    ).toEqual({ status: "no-match" });
  });

  it("fails closed for no match, invalid totals, and multiple exact matches", () => {
    expect(
      matchFeeRules(
        { platform: "OKX", assetSymbol: "ETH", totalValue: "1" },
        [fixed],
      ),
    ).toEqual({ status: "no-match" });
    expect(
      matchFeeRules(
        { platform: "OKX", assetSymbol: "BTC", totalValue: "not-decimal" },
        [fixed],
      ),
    ).toEqual({ status: "invalid-total-value" });

    const conflict = matchFeeRules(
      { platform: "OKX", assetSymbol: "BTC", totalValue: "6500" },
      [fixed, { ...fixed, id: "fee-okx-btc-conflict", amount: "7" }],
    );
    expect(conflict.status).toBe("conflict");
    if (conflict.status !== "conflict") return;
    expect(conflict.candidates.map(({ fee }) => fee)).toEqual(["5", "7"]);
  });
});
