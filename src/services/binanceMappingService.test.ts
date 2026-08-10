import { describe, expect, it } from "vitest";

import { createInitialLedgerData } from "../state/initialLedgerData";
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
  delete ledgerData.assets[0].binanceMapping;
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
});
