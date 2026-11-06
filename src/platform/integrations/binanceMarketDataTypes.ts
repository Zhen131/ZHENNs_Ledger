/**
 * 这个文件管跟 Binance 要行情时，结果和错误长什么样。
 * 它不管怎么去要，那在 binanceMarketDataClient.ts。
 * 没有特别的决定。
 */

import type { DecimalString } from "@/core/models";

/**
 * 跟 Binance 要行情可能失败的原因代码。
 * 例如超时、限流、交易对不存在。
 */
export type BinanceMarketDataFailureCode =
  | "BINANCE_INVALID_SYMBOL_INPUT"
  | "BINANCE_ABORTED"
  | "BINANCE_TIMEOUT"
  | "BINANCE_VALIDATION_UNAVAILABLE"
  | "BINANCE_NETWORK_ERROR"
  | "BINANCE_HTTP_ERROR"
  | "BINANCE_RATE_LIMITED"
  | "BINANCE_MALFORMED_RESPONSE"
  | "BINANCE_SYMBOL_MISSING"
  | "BINANCE_SYMBOL_DUPLICATE"
  | "BINANCE_SYMBOL_NOT_TRADING"
  | "BINANCE_BASE_ASSET_MISMATCH"
  | "BINANCE_QUOTE_ASSET_MISMATCH"
  | "BINANCE_SPOT_NOT_ALLOWED"
  | "BINANCE_INVALID_PRICE";

/**
 * 一次失败。
 * 包括原因代码、哪个交易对、说明。
 * 有网页状态码时也带上。
 */
export type BinanceMarketDataFailure = {
  code: BinanceMarketDataFailureCode;
  symbol: string;
  message: string;
  httpStatus?: number;
};

/**
 * Binance 回答的一个交易对。
 * 包括名字、状态、基础币、报价币、能不能现货交易。
 */
export type BinanceExchangeSymbol = {
  symbol: string;
  status: string;
  baseAsset: string;
  quoteAsset: string;
  isSpotTradingAllowed: boolean;
};

/** Binance 回答的一个交易对的最新价格。 */
export type BinanceTickerPrice = {
  symbol: string;
  price: DecimalString;
};

/** 查一个交易对的结果：要么是它的信息，要么是一次失败。 */
export type BinanceSymbolValidationResult =
  | { ok: true; value: BinanceExchangeSymbol }
  | { ok: false; error: BinanceMarketDataFailure };

/**
 * 一次取多个价格的结果。
 * 取到的价格和失败的交易对分开放。
 */
export type BinanceTickerBatchResult = {
  prices: BinanceTickerPrice[];
  failures: BinanceMarketDataFailure[];
};
