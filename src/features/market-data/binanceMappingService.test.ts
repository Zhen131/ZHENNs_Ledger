import { describe, expect, it } from "vitest";

import { createInitialLedgerData } from "@/core/state";
import { createUsdtSimpleTrade } from "@/test-support";
import {
  getBinanceMappingSignature,
  setAssetBinanceMapping,
} from "./binanceMappingService";

const UPDATED_AT = "2026-08-10T08:00:00.000Z";
const BTC_MAPPING = {
  provider: "binance" as const,
  symbol: "BTCUSDT",
  baseAsset: "BTC",
  quoteAsset: "USDT" as const,
};

function createLedgerWithAbsentBtcMapping() {
  const ledgerData = createInitialLedgerData();
  delete (ledgerData.assets[0] as unknown as { binanceMapping?: unknown })
    .binanceMapping;
  return ledgerData;
}

describe("Binance mapping persistence operations", () => {
  it("persists an explicit mapping when the runtime fallback has the same value", () => {
    const ledgerData = createLedgerWithAbsentBtcMapping();

    const updated = setAssetBinanceMapping(
      ledgerData,
      "BTC",
      BTC_MAPPING,
      UPDATED_AT,
    );

    expect(updated).not.toBe(ledgerData);
    expect(updated.assets[0].binanceMapping).toEqual(BTC_MAPPING);
    expect(updated.assets[0].updatedAt).toBe(UPDATED_AT);
    expect(Object.hasOwn(ledgerData.assets[0], "binanceMapping")).toBe(false);
  });

  it("writes explicit null when a user deletes an absent mapping and keeps null stable", () => {
    const ledgerData = createLedgerWithAbsentBtcMapping();

    const disabled = setAssetBinanceMapping(
      ledgerData,
      "BTC",
      null,
      UPDATED_AT,
    );

    expect(disabled).not.toBe(ledgerData);
    expect(Object.hasOwn(disabled.assets[0], "binanceMapping")).toBe(true);
    expect(disabled.assets[0].binanceMapping).toBeNull();
    expect(
      setAssetBinanceMapping(
        disabled,
        "BTC",
        null,
        "2026-08-10T09:00:00.000Z",
      ),
    ).toBe(disabled);
  });

  it("signs effective runtime mappings while distinguishing explicit disable", () => {
    const absent = createLedgerWithAbsentBtcMapping();
    const explicit = setAssetBinanceMapping(
      absent,
      "BTC",
      BTC_MAPPING,
      UPDATED_AT,
    );
    const disabled = setAssetBinanceMapping(
      absent,
      "BTC",
      null,
      UPDATED_AT,
    );

    expect(getBinanceMappingSignature(absent)).toBe(
      getBinanceMappingSignature(explicit),
    );
    expect(getBinanceMappingSignature(disabled)).not.toBe(
      getBinanceMappingSignature(absent),
    );
  });

  it("deletes only the mapping while preserving every asset dependency", () => {
    const ledgerData = createInitialLedgerData();
    ledgerData.trades = [
      createUsdtSimpleTrade("btc-trade", "buy", "BTC", "1", "2026-08-10"),
    ];
    ledgerData.priceSnapshots = [
      {
        id: "btc-price",
        assetSymbol: "BTC",
        price: "100000",
        currency: "USDT",
        recordedAt: "2026-08-10",
        source: "manual",
        createdAt: UPDATED_AT,
        updatedAt: UPDATED_AT,
      },
    ];
    ledgerData.feeRules = [
      {
        id: "btc-fee",
        name: "BTC fee",
        platform: "Binance",
        assetSymbol: "BTC",
        status: "active",
        type: "percentage",
        rate: "0.001",
        currency: "USDT",
        createdAt: UPDATED_AT,
        updatedAt: UPDATED_AT,
      },
    ];

    const updated = setAssetBinanceMapping(
      ledgerData,
      "BTC",
      null,
      UPDATED_AT,
    );

    expect(updated.assets[0]).toMatchObject({
      symbol: "BTC",
      binanceMapping: null,
      updatedAt: UPDATED_AT,
    });
    expect(updated.trades).toBe(ledgerData.trades);
    expect(updated.priceSnapshots).toBe(ledgerData.priceSnapshots);
    expect(updated.feeRules).toBe(ledgerData.feeRules);
    expect(updated.assets).toHaveLength(ledgerData.assets.length);
  });
});
