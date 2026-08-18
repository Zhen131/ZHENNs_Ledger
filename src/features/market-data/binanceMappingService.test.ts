import { describe, expect, it, vi } from "vitest";

import { createInitialLedgerData } from "@/core/state";
import { createUsdtSimpleTrade } from "@/test-support";
import {
  autoPairMissingBinanceMappings,
  getBinanceMappingSignature,
  listAssetsMissingBinanceMapping,
  mergeAutoPairedBinanceMappings,
  normalizeBinanceSymbolCandidate,
  setAssetBinanceMapping,
  validateBinanceMapping,
} from "./binanceMappingService";

const UPDATED_AT = "2026-08-10T08:00:00.000Z";
const BTC_MAPPING = {
  provider: "binance" as const,
  symbol: "BTCUSDT",
  baseAsset: "BTC",
  quoteAsset: "USDT" as const,
};

function createLedgerWithNullBtcMapping() {
  const ledgerData = createInitialLedgerData();
  ledgerData.assets[0].binanceMapping = null;
  return ledgerData;
}

describe("Binance mapping persistence operations", () => {
  it("persists an explicit mapping from an explicit null", () => {
    const ledgerData = createLedgerWithNullBtcMapping();

    const updated = setAssetBinanceMapping(
      ledgerData,
      "BTC",
      BTC_MAPPING,
      UPDATED_AT,
    );

    expect(updated).not.toBe(ledgerData);
    expect(updated.assets[0].binanceMapping).toEqual(BTC_MAPPING);
    expect(updated.assets[0].updatedAt).toBe(UPDATED_AT);
    expect(ledgerData.assets[0].binanceMapping).toBeNull();
  });

  it("keeps explicit null stable without rewriting updatedAt", () => {
    const ledgerData = createLedgerWithNullBtcMapping();

    const disabled = setAssetBinanceMapping(
      ledgerData,
      "BTC",
      null,
      UPDATED_AT,
    );

    expect(disabled).toBe(ledgerData);
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

  it("signs only explicit mappings and distinguishes explicit null", () => {
    const absent = createLedgerWithNullBtcMapping();
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

    expect(getBinanceMappingSignature(absent)).not.toBe(
      getBinanceMappingSignature(explicit),
    );
    expect(getBinanceMappingSignature(disabled)).toBe(
      getBinanceMappingSignature(absent),
    );
  });

  it.each([
    ["SOL", "SOLUSDT"],
    [" solusdt ", "SOLUSDT"],
    ["ETHUSDT", "ETHUSDT"],
    ["SOLUSDC", "SOLUSDC"],
  ])("normalizes %s to the single requested candidate", (input, symbol) => {
    expect(normalizeBinanceSymbolCandidate("SOL", input)).toEqual({
      ok: true,
      symbol,
    });
  });

  it("rejects invalid candidates before making any network request", async () => {
    const client = {
      validateSpotSymbol: vi.fn(),
      fetchLatestPrices: vi.fn(),
    };
    const result = await validateBinanceMapping(
      client,
      "SOL",
      "SOL-USDT",
    );
    expect(result).toEqual({
      ok: false,
      error: expect.objectContaining({
        code: "BINANCE_INVALID_SYMBOL_INPUT",
      }),
    });
    expect(client.validateSpotSymbol).not.toHaveBeenCalled();
  });

  it("lists missing mappings in stable symbol order", () => {
    const ledgerData = createInitialLedgerData();
    ledgerData.assets[0].binanceMapping = null;
    ledgerData.assets[2].binanceMapping = null;
    expect(listAssetsMissingBinanceMapping(ledgerData)).toEqual(["ADA", "BTC"]);
  });

  it("auto-pairs a frozen missing list in symbol order without retrying failures", async () => {
    const client = {
      validateSpotSymbol: vi.fn(async (assetSymbol: string, symbol: string) =>
        assetSymbol === "KNIGHT"
          ? {
              ok: false as const,
              error: {
                code: "BINANCE_SYMBOL_MISSING" as const,
                symbol,
                message: "missing",
              },
            }
          : {
              ok: true as const,
              value: {
                symbol,
                status: "TRADING",
                baseAsset: assetSymbol,
                quoteAsset: "USDT",
                isSpotTradingAllowed: true,
              },
            },
      ),
      fetchLatestPrices: vi.fn(),
    };

    const result = await autoPairMissingBinanceMappings(
      client,
      ["SOL", "KNIGHT", "SOL"],
    );

    expect(client.validateSpotSymbol.mock.calls.map((call) => call[0])).toEqual([
      "KNIGHT",
      "SOL",
    ]);
    expect(result.successes).toEqual([
      expect.objectContaining({
        assetSymbol: "SOL",
        mapping: expect.objectContaining({ symbol: "SOLUSDT" }),
      }),
    ]);
    expect(result.failures).toEqual([
      expect.objectContaining({
        assetSymbol: "KNIGHT",
        code: "BINANCE_SYMBOL_MISSING",
      }),
    ]);
    expect(client.validateSpotSymbol).toHaveBeenCalledTimes(2);
    expect(client.fetchLatestPrices).not.toHaveBeenCalled();
  });

  it("stops auto-pairing after abort and conditionally merges only still-null assets", async () => {
    const abortController = new AbortController();
    const client = {
      validateSpotSymbol: vi.fn(async (assetSymbol: string, symbol: string) => {
        abortController.abort();
        return {
          ok: true as const,
          value: {
            symbol,
            status: "TRADING",
            baseAsset: assetSymbol,
            quoteAsset: "USDT",
            isSpotTradingAllowed: true,
          },
        };
      }),
      fetchLatestPrices: vi.fn(),
    };
    await expect(
      autoPairMissingBinanceMappings(
        client,
        ["ADA", "BTC"],
        abortController.signal,
      ),
    ).resolves.toEqual({ successes: [], failures: [] });
    expect(client.validateSpotSymbol).toHaveBeenCalledOnce();

    const ledgerData = createInitialLedgerData();
    ledgerData.assets[0].binanceMapping = null;
    ledgerData.assets[1].binanceMapping = null;
    const merged = mergeAutoPairedBinanceMappings(
      ledgerData,
      [
        { assetSymbol: "BTC", mapping: BTC_MAPPING },
        {
          assetSymbol: "ETH",
          mapping: {
            ...BTC_MAPPING,
            symbol: "ETHUSDT",
            baseAsset: "ETH",
          },
        },
        {
          assetSymbol: "REMOVED",
          mapping: {
            ...BTC_MAPPING,
            symbol: "REMOVEDUSDT",
            baseAsset: "REMOVED",
          },
        },
      ],
      UPDATED_AT,
    );
    expect(merged.appliedAssetSymbols).toEqual(["BTC", "ETH"]);
    expect(merged.skippedAssetSymbols).toEqual(["REMOVED"]);
    expect(merged.ledgerData.assets[0].binanceMapping?.symbol).toBe("BTCUSDT");
    expect(merged.ledgerData.assets[1].binanceMapping?.symbol).toBe("ETHUSDT");
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
