import type { DecimalString } from "../models";

export type BinanceMarketDataFailureCode =
  | "BINANCE_ABORTED"
  | "BINANCE_TIMEOUT"
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

export type BinanceMarketDataFailure = {
  code: BinanceMarketDataFailureCode;
  symbol: string;
  message: string;
  httpStatus?: number;
};

export type BinanceExchangeSymbol = {
  symbol: string;
  status: string;
  baseAsset: string;
  quoteAsset: string;
  isSpotTradingAllowed: boolean;
};

export type BinanceTickerPrice = {
  symbol: string;
  price: DecimalString;
};

export type BinanceSymbolValidationResult =
  | { ok: true; value: BinanceExchangeSymbol }
  | { ok: false; error: BinanceMarketDataFailure };

export type BinanceTickerBatchResult = {
  prices: BinanceTickerPrice[];
  failures: BinanceMarketDataFailure[];
};
