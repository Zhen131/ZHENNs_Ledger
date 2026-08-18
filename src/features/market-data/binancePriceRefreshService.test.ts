import { describe, expect, it, vi } from "vitest";

import type { BinanceMarketDataClient } from "@/platform/integrations";
import type { LedgerClock } from "@/core/shared";
import { createInitialLedgerData } from "@/core/state";
import {
  createPriceSnapshot,
  createSimpleTrade,
} from "@/test-support";
import {
  mergeBinancePriceRefresh,
  refreshBinancePrices,
  type BinanceRefreshSuccess,
} from "./binancePriceRefreshService";

const TODAY = "2026-07-25";
const RESPONSE_TIME = new Date(2026, 6, 26, 0, 0, 1);
const clock: LedgerClock = {
  now: () => RESPONSE_TIME,
};

function success(
  price: string,
  recordedAt = "2026-07-26",
): BinanceRefreshSuccess {
  return {
    assetSymbol: "BTC",
    mapping: {
      provider: "binance",
      symbol: "BTCUSDT",
      baseAsset: "BTC",
      quoteAsset: "USDT",
    },
    price,
    recordedAt,
    fetchedAt: "2026-07-26T00:00:01.000Z",
  };
}

function createClient(): BinanceMarketDataClient {
  return {
    validateSpotSymbol: vi.fn(async (assetSymbol, symbol) =>
      assetSymbol === "ETH"
        ? {
            ok: false as const,
            error: {
              code: "BINANCE_NETWORK_ERROR" as const,
              symbol,
              message: "offline",
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
    fetchLatestPrices: vi.fn(async () => ({
      prices: [{ symbol: "BTCUSDT", price: "70000" }],
      failures: [],
    })),
  };
}

describe("Binance price refresh", () => {
  it("uses an absent built-in mapping only at runtime without materializing it", async () => {
    const ledgerData = createInitialLedgerData();
    delete (ledgerData.assets[0] as unknown as { binanceMapping?: unknown })
      .binanceMapping;
    ledgerData.trades = [
      createSimpleTrade("btc", "buy", "BTC", "1", "2026-07-20"),
    ];
    const client = createClient();

    const result = await refreshBinancePrices(
      ledgerData,
      TODAY,
      { client, clock },
    );

    expect(result.successes).toEqual([
      expect.objectContaining({
        assetSymbol: "BTC",
        mapping: expect.objectContaining({ symbol: "BTCUSDT" }),
      }),
    ]);
    expect(Object.hasOwn(ledgerData.assets[0], "binanceMapping")).toBe(false);

    const merged = mergeBinancePriceRefresh(
      ledgerData,
      result.successes,
      () => "runtime-fallback-price",
    );
    expect(merged.appliedAssetSymbols).toEqual(["BTC"]);
    expect(merged.ledgerData.priceSnapshots).toEqual([
      expect.objectContaining({
        id: "runtime-fallback-price",
        currency: "USDT",
      }),
    ]);
    expect(
      Object.hasOwn(merged.ledgerData.assets[0], "binanceMapping"),
    ).toBe(false);
  });

  it("treats explicit null as a durable runtime disable", async () => {
    const ledgerData = createInitialLedgerData();
    ledgerData.assets[0].binanceMapping = null;
    ledgerData.trades = [
      createSimpleTrade("btc", "buy", "BTC", "1", "2026-07-20"),
    ];
    const client = createClient();

    await expect(
      refreshBinancePrices(ledgerData, TODAY, { client, clock }),
    ).resolves.toEqual({ successes: [], failures: [] });
    expect(client.validateSpotSymbol).not.toHaveBeenCalled();
    expect(client.fetchLatestPrices).not.toHaveBeenCalled();
    expect(ledgerData.assets[0].binanceMapping).toBeNull();
  });

  it("validates only mapped nonzero holdings and supports partial success", async () => {
    const ledgerData = createInitialLedgerData();
    ledgerData.trades = [
      createSimpleTrade("btc", "buy", "BTC", "1", "2026-07-20"),
      createSimpleTrade("eth", "buy", "ETH", "1", "2026-07-20"),
    ];
    const client = createClient();

    const result = await refreshBinancePrices(
      ledgerData,
      TODAY,
      { client, clock },
    );
    expect(client.validateSpotSymbol).toHaveBeenCalledTimes(2);
    expect(client.fetchLatestPrices).toHaveBeenCalledWith(
      ["BTCUSDT"],
      undefined,
    );
    expect(result.successes).toEqual([
      expect.objectContaining({
        assetSymbol: "BTC",
        price: "70000",
        recordedAt: "2026-07-26",
        fetchedAt: RESPONSE_TIME.toISOString(),
      }),
    ]);
    expect(result.failures).toEqual([
      expect.objectContaining({
        assetSymbol: "ETH",
        code: "BINANCE_NETWORK_ERROR",
      }),
    ]);
  });

  it("upserts the same response day, preserves id/createdAt/manual facts, and appends across days", () => {
    const ledgerData = createInitialLedgerData();
    ledgerData.priceSnapshots = [
      createPriceSnapshot("manual", "BTC", "65000", "2026-07-26"),
    ];
    const first = mergeBinancePriceRefresh(
      ledgerData,
      [success("70000")],
      () => "api-id",
    );
    expect(first.appliedAssetSymbols).toEqual(["BTC"]);
    expect(first.ledgerData.priceSnapshots).toHaveLength(2);
    const created = first.ledgerData.priceSnapshots[1];

    const second = mergeBinancePriceRefresh(
      first.ledgerData,
      [
        {
          ...success("71000"),
          fetchedAt: "2026-07-26T12:00:00Z",
        },
      ],
      () => "unused",
    );
    expect(second.ledgerData.priceSnapshots).toHaveLength(2);
    expect(second.ledgerData.priceSnapshots[0].id).toBe("manual");
    expect(second.ledgerData.priceSnapshots[1]).toEqual(
      expect.objectContaining({
        id: created.id,
        createdAt: created.createdAt,
        price: "71000",
        updatedAt: "2026-07-26T12:00:00Z",
      }),
    );

    const third = mergeBinancePriceRefresh(
      second.ledgerData,
      [
        {
          ...success("72000", "2026-07-27"),
          fetchedAt: "2026-07-27T12:00:00Z",
        },
      ],
      () => "api-next-day",
    );
    expect(third.ledgerData.priceSnapshots).toHaveLength(3);
    expect(third.ledgerData.priceSnapshots[2].id).toBe("api-next-day");
  });

  it("repairs legacy daily duplicates using latest fetchedAt then array order", () => {
    const ledgerData = createInitialLedgerData();
    const base = mergeBinancePriceRefresh(
      ledgerData,
      [success("69000")],
      () => "first",
    ).ledgerData.priceSnapshots[0];
    ledgerData.priceSnapshots = [
      base,
      {
        ...base,
        id: "second",
        price: "69500",
        binanceProvenance: {
          ...base.binanceProvenance!,
          fetchedAt: "2026-07-26T08:00:00Z",
        },
        createdAt: "2026-07-26T08:00:00Z",
      },
    ];

    const merged = mergeBinancePriceRefresh(
      ledgerData,
      [
        {
          ...success("71000"),
          fetchedAt: "2026-07-26T12:00:00Z",
        },
      ],
      () => "unused",
    );
    expect(merged.ledgerData.priceSnapshots).toHaveLength(1);
    expect(merged.ledgerData.priceSnapshots[0]).toEqual(
      expect.objectContaining({
        id: "second",
        createdAt: "2026-07-26T08:00:00Z",
        price: "71000",
      }),
    );
  });

  it("drops responses after mapping deletion and preserves concurrent ledger facts", () => {
    const requestStartLedger = createInitialLedgerData();
    const latestLedger = {
      ...requestStartLedger,
      trades: [
        createSimpleTrade("concurrent", "buy", "BTC", "1", "2026-07-25"),
      ],
    };
    const merged = mergeBinancePriceRefresh(
      latestLedger,
      [success("70000")],
      () => "api",
    );
    expect(merged.ledgerData.trades.map((trade) => trade.id)).toEqual([
      "concurrent",
    ]);

    const deletedMappingLedger = {
      ...latestLedger,
      assets: latestLedger.assets.map((asset) =>
        asset.symbol === "BTC"
          ? { ...asset, binanceMapping: null }
          : asset,
      ),
    };
    const skipped = mergeBinancePriceRefresh(
      deletedMappingLedger,
      [success("70000")],
      () => "unused",
    );
    expect(skipped.ledgerData).toBe(deletedMappingLedger);
    expect(skipped.skippedAssetSymbols).toEqual(["BTC"]);
  });

  it("skips legacy USD assets without creating or rewriting a Binance price", async () => {
    const ledgerData = createInitialLedgerData();
    ledgerData.assets = ledgerData.assets.map((asset) => ({
      ...asset,
      quoteCurrency: "USD" as never,
    }));
    delete (ledgerData.assets[0] as unknown as { binanceMapping?: unknown })
      .binanceMapping;
    ledgerData.trades = [
      createSimpleTrade("legacy-btc", "buy", "BTC", "1", "2026-07-20"),
    ];
    ledgerData.priceSnapshots = [
      createPriceSnapshot("legacy-price", "BTC", "65000", "2026-07-20"),
    ];
    const client = createClient();

    await expect(
      refreshBinancePrices(ledgerData, TODAY, { client, clock }),
    ).resolves.toEqual({ successes: [], failures: [] });
    expect(client.validateSpotSymbol).not.toHaveBeenCalled();

    const merged = mergeBinancePriceRefresh(
      ledgerData,
      [success("70000")],
      () => "unused",
    );
    expect(merged.ledgerData).toBe(ledgerData);
    expect(merged.skippedAssetSymbols).toEqual(["BTC"]);
    expect(ledgerData.priceSnapshots).toEqual([
      expect.objectContaining({ id: "legacy-price", currency: "USD" }),
    ]);
    expect(Object.hasOwn(ledgerData.assets[0], "binanceMapping")).toBe(false);
  });
});
