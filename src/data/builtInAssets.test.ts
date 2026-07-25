import { expect, test } from "vitest";

import { createBuiltInAssets } from "./builtInAssets";

const EXPECTED_ASSETS = [
  {
    id: "asset-btc",
    symbol: "BTC",
    name: "Bitcoin",
    quoteCurrency: "USD",
    binanceMapping: {
      provider: "binance",
      symbol: "BTCUSDT",
      baseAsset: "BTC",
      quoteAsset: "USDT",
    },
    createdAt: "2026-07-13T00:00:00Z",
    updatedAt: "2026-07-13T00:00:00Z",
  },
  {
    id: "asset-eth",
    symbol: "ETH",
    name: "Ethereum",
    quoteCurrency: "USD",
    binanceMapping: {
      provider: "binance",
      symbol: "ETHUSDT",
      baseAsset: "ETH",
      quoteAsset: "USDT",
    },
    createdAt: "2026-07-13T00:00:00Z",
    updatedAt: "2026-07-13T00:00:00Z",
  },
  {
    id: "asset-ada",
    symbol: "ADA",
    name: "Cardano",
    quoteCurrency: "USD",
    binanceMapping: {
      provider: "binance",
      symbol: "ADAUSDT",
      baseAsset: "ADA",
      quoteAsset: "USDT",
    },
    createdAt: "2026-07-13T00:00:00Z",
    updatedAt: "2026-07-13T00:00:00Z",
  },
];

test("creates the fixed production asset catalog", () => {
  expect(createBuiltInAssets()).toEqual(EXPECTED_ASSETS);
});

test("keeps built-in asset ids and symbols unique", () => {
  const assets = createBuiltInAssets();

  expect(new Set(assets.map((asset) => asset.id)).size).toBe(assets.length);
  expect(new Set(assets.map((asset) => asset.symbol)).size).toBe(
    assets.length,
  );
});

test("creates independent arrays and asset objects", () => {
  const firstAssets = createBuiltInAssets();
  const secondAssets = createBuiltInAssets();

  expect(firstAssets).not.toBe(secondAssets);
  for (const [index, asset] of firstAssets.entries()) {
    expect(asset).not.toBe(secondAssets[index]);
  }

  firstAssets[0].name = "Changed Bitcoin";
  firstAssets[0].binanceMapping!.symbol = "CHANGED";
  expect(secondAssets[0].name).toBe("Bitcoin");
  expect(secondAssets[0].binanceMapping?.symbol).toBe("BTCUSDT");
  expect(createBuiltInAssets()).toEqual(EXPECTED_ASSETS);
});
