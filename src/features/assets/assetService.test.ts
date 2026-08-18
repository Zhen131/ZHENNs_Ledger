import { afterEach, describe, expect, it, vi } from "vitest";

import type { Asset, LedgerData } from "@/core/models";
import { createInitialLedgerData } from "@/core/state";
import { createValidatedPriceSnapshot } from "@/features/prices";
import { getPositionsFromLedger } from "@/features/portfolio";
import { createUsdtSimpleTrade } from "@/test-support";
import {
  ASSET_ERROR_CODES,
  createLocalAsset,
  inspectAssetDependencies,
  normalizeAssetSymbol,
  removeLocalAsset,
} from "./assetService";

const TIMESTAMP = "2026-08-18T08:00:00.000Z";

afterEach(() => vi.unstubAllGlobals());

describe("local asset creation", () => {
  it.each([
    [" sol ", "SOL"],
    ["doge", "DOGE"],
    ["BNB", "BNB"],
    ["okb", "OKB"],
    ["KNIGHT", "KNIGHT"],
  ])("normalizes and creates %s fully offline", (input, symbol) => {
    const fetchSpy = vi.fn();
    vi.stubGlobal("fetch", fetchSpy);
    const result = createLocalAsset(
      input,
      createInitialLedgerData(),
      dependencies([`asset-${symbol.toLowerCase()}`]),
    );

    expect(result).toEqual({
      ok: true,
      asset: {
        id: `asset-${symbol.toLowerCase()}`,
        symbol,
        name: symbol,
        quoteCurrency: "USDT",
        binanceMapping: null,
        createdAt: TIMESTAMP,
        updatedAt: TIMESTAMP,
      },
    });
    expect(result.ok && result.asset).not.toHaveProperty("decimals");
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it.each([
    ["", ASSET_ERROR_CODES.INVALID_SYMBOL],
    ["USDT", ASSET_ERROR_CODES.RESERVED_SYMBOL],
    ["SOL-USDT", ASSET_ERROR_CODES.INVALID_SYMBOL],
    ["骑士", ASSET_ERROR_CODES.INVALID_SYMBOL],
    ["A".repeat(33), ASSET_ERROR_CODES.INVALID_SYMBOL],
  ])("rejects %s with a stable code", (input, code) => {
    const result = normalizeAssetSymbol(input);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe(code);
  });

  it("rejects normalized duplicates before reading ID or time", () => {
    const deps = dependencies(["unused"]);
    const result = createLocalAsset(" btc ", createInitialLedgerData(), deps);

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe(ASSET_ERROR_CODES.DUPLICATE_SYMBOL);
    }
    expect(deps.generateId).not.toHaveBeenCalled();
    expect(deps.now).not.toHaveBeenCalled();
  });

  it("retries global collisions and reads the clock once only after success", () => {
    const ledgerData = createInitialLedgerData();
    ledgerData.cashEvents = [
      {
        id: "cash-collision",
        occurredAt: "2026-08-18",
        timePrecision: "day",
        type: "deposit",
        currency: "USDT",
        amount: "1",
        createdAt: TIMESTAMP,
        updatedAt: TIMESTAMP,
      },
    ];
    const deps = dependencies([
      "asset-btc",
      "cash-collision",
      "asset-sol",
    ]);

    const result = createLocalAsset("SOL", ledgerData, deps);

    expect(result.ok).toBe(true);
    if (result.ok) expect(result.asset.id).toBe("asset-sol");
    expect(deps.generateId).toHaveBeenCalledTimes(3);
    expect(deps.now).toHaveBeenCalledTimes(1);
  });

  it("returns exhausted after three collisions with zero time reads", () => {
    const deps = dependencies(["asset-btc", "asset-btc", "asset-btc"]);
    const result = createLocalAsset("SOL", createInitialLedgerData(), deps);

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe(
        ASSET_ERROR_CODES.ID_GENERATION_EXHAUSTED,
      );
    }
    expect(deps.generateId).toHaveBeenCalledTimes(3);
    expect(deps.now).not.toHaveBeenCalled();
  });
});

describe("local asset removal", () => {
  it("reports every blocking collection and representative exact path", () => {
    const ledgerData = ledgerWithSol();
    ledgerData.trades = [
      {
        ...createUsdtSimpleTrade(
          "sol-trade",
          "buy",
          "SOL",
          "1",
          "2026-08-18",
        ),
        fee: "0.1",
        feeCurrency: "SOL",
      },
    ];
    ledgerData.priceSnapshots = [
      {
        id: "sol-price",
        assetSymbol: "SOL",
        price: "150",
        currency: "USDT",
        recordedAt: "2026-08-18",
        source: "manual",
        createdAt: TIMESTAMP,
        updatedAt: TIMESTAMP,
      },
    ];
    ledgerData.feeRules = [
      {
        id: "sol-active-fee",
        name: "SOL active",
        platform: "Binance",
        assetSymbol: "SOL",
        status: "active",
        type: "fixed",
        amount: "0.1",
        currency: "USDT",
        createdAt: TIMESTAMP,
        updatedAt: TIMESTAMP,
      },
      {
        id: "sol-inactive-fee",
        name: "SOL inactive",
        platform: "OKX",
        assetSymbol: "SOL",
        status: "inactive",
        type: "fixed",
        amount: "0.2",
        currency: "USDT",
        deactivatedAt: TIMESTAMP,
        createdAt: TIMESTAMP,
        updatedAt: TIMESTAMP,
      },
    ];

    expect(inspectAssetDependencies("SOL", ledgerData)).toEqual([
      {
        collection: "trades",
        count: 2,
        paths: ["trades[0].assetSymbol", "trades[0].feeCurrency"],
      },
      {
        collection: "priceSnapshots",
        count: 1,
        paths: ["priceSnapshots[0].assetSymbol"],
      },
      {
        collection: "feeRules",
        count: 2,
        paths: [
          "feeRules[0].assetSymbol",
          "feeRules[1].assetSymbol",
        ],
      },
    ]);
    const removed = removeLocalAsset("SOL", ledgerData);
    expect(removed.ok).toBe(false);
    if (!removed.ok) {
      expect(removed.error.code).toBe(ASSET_ERROR_CODES.DEPENDENCY_EXISTS);
      expect(removed.error.dependencies).toHaveLength(3);
    }
    expect(ledgerData.assets.some((asset) => asset.symbol === "SOL")).toBe(
      true,
    );
  });

  it("removes an empty mapped asset without touching other facts", () => {
    const ledgerData = ledgerWithSol({
      provider: "binance",
      symbol: "SOLUSDT",
      baseAsset: "SOL",
      quoteAsset: "USDT",
    });
    const originalTrades = ledgerData.trades;
    const result = removeLocalAsset(" sol ", ledgerData);

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.ledgerData.assets.some((asset) => asset.symbol === "SOL")).toBe(
      false,
    );
    expect(result.ledgerData.trades).toBe(originalTrades);
    expect(ledgerData.assets.some((asset) => asset.symbol === "SOL")).toBe(
      true,
    );
  });
});

describe("manual price continuity", () => {
  it("values a mapping-free SOL position from a manual USDT price", () => {
    const ledgerData = ledgerWithSol();
    ledgerData.trades = [
      createUsdtSimpleTrade(
        "sol-buy",
        "buy",
        "SOL",
        "2",
        "2026-08-18",
      ),
    ];
    const priceResult = createValidatedPriceSnapshot(
      {
        assetSymbol: "SOL",
        price: "150",
        currency: "USDT",
        recordedAt: "2026-08-18",
        source: "manual",
      },
      ledgerData,
      {
        generateId: () => "sol-manual-price",
        now: () => TIMESTAMP,
        todayKey: () => "2026-08-18",
      },
    );
    expect(priceResult.ok).toBe(true);
    if (!priceResult.ok) return;
    ledgerData.priceSnapshots.push(priceResult.priceSnapshot);

    const position = getPositionsFromLedger(ledgerData, {
      todayKey: "2026-08-18",
      mode: "auto",
    }).find((item) => item.assetSymbol === "SOL");

    expect(position).toMatchObject({
      quantity: "2",
      latestPrice: "150",
      marketValue: "300",
    });
  });
});

function dependencies(ids: string[]) {
  return {
    generateId: vi.fn(() => ids.shift() ?? "fallback-id"),
    now: vi.fn(() => TIMESTAMP),
  };
}

function ledgerWithSol(
  binanceMapping: Asset["binanceMapping"] = null,
): LedgerData {
  const ledgerData = createInitialLedgerData();
  ledgerData.assets.push({
    id: "asset-sol",
    symbol: "SOL",
    name: "SOL",
    quoteCurrency: "USDT",
    binanceMapping,
    createdAt: TIMESTAMP,
    updatedAt: TIMESTAMP,
  });
  return ledgerData;
}
