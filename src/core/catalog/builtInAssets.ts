import type { Asset } from "@/core/models";

const BUILT_IN_ASSET_TIMESTAMP = "2026-07-13T00:00:00Z";

const BUILT_IN_ASSET_DEFINITIONS = [
  {
    id: "asset-btc",
    symbol: "BTC",
    name: "Bitcoin",
    quoteCurrency: "USDT",
    binanceMapping: {
      provider: "binance",
      symbol: "BTCUSDT",
      baseAsset: "BTC",
      quoteAsset: "USDT",
    },
    createdAt: BUILT_IN_ASSET_TIMESTAMP,
    updatedAt: BUILT_IN_ASSET_TIMESTAMP,
  },
  {
    id: "asset-eth",
    symbol: "ETH",
    name: "Ethereum",
    quoteCurrency: "USDT",
    binanceMapping: {
      provider: "binance",
      symbol: "ETHUSDT",
      baseAsset: "ETH",
      quoteAsset: "USDT",
    },
    createdAt: BUILT_IN_ASSET_TIMESTAMP,
    updatedAt: BUILT_IN_ASSET_TIMESTAMP,
  },
  {
    id: "asset-ada",
    symbol: "ADA",
    name: "Cardano",
    quoteCurrency: "USDT",
    binanceMapping: {
      provider: "binance",
      symbol: "ADAUSDT",
      baseAsset: "ADA",
      quoteAsset: "USDT",
    },
    createdAt: BUILT_IN_ASSET_TIMESTAMP,
    updatedAt: BUILT_IN_ASSET_TIMESTAMP,
  },
] satisfies readonly Asset[];

export function createBuiltInAssets(): Asset[] {
  return BUILT_IN_ASSET_DEFINITIONS.map((asset) => ({
    ...asset,
    binanceMapping: { ...asset.binanceMapping },
  }));
}
