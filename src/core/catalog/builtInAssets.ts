/**
 * 这个文件管新账本自带的三个资产：BTC、ETH、ADA。
 * 每个都配好了 Binance 交易对。
 * 它不管用户自己加的资产，那在功能区的资产设置里。
 * 不显然的决定：自带这三个只为第一次用方便，不是白名单。2026-08-19 定（W14 01B 第 3.6 节）。
 */

import type { Asset } from "@/core/models";

/** 自带资产统一用的录入时间，2026-07-13。为什么是这天：这是猜的，日志里没写，要核。 */
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

/**
 * 这个函数给出三个自带资产的新副本，改副本不会改到原件。
 * 举例：调用两次 → 答两份内容相同、互不影响的列表。
 */
export function createBuiltInAssets(): Asset[] {
  return BUILT_IN_ASSET_DEFINITIONS.map((asset) => ({
    ...asset,
    binanceMapping: { ...asset.binanceMapping },
  }));
}
