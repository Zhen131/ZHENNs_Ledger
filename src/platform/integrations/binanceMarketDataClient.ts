import { isPositive } from "@/core/shared";
import type {
  BinanceExchangeSymbol,
  BinanceMarketDataFailure,
  BinanceSymbolValidationResult,
  BinanceTickerBatchResult,
} from "./binanceMarketDataTypes";

export const BINANCE_MARKET_DATA_BASE_URL =
  "https://data-api.binance.vision";
export const BINANCE_MARKET_DATA_TIMEOUT_MS = 8_000;
const DECIMAL_STRING_PATTERN = /^-?(?:0|[1-9]\d*)(?:\.\d+)?$/;

export type BinanceMarketDataClient = {
  validateSpotSymbol(
    assetSymbol: string,
    marketSymbol: string,
    signal?: AbortSignal,
  ): Promise<BinanceSymbolValidationResult>;
  fetchLatestPrices(
    symbols: readonly string[],
    signal?: AbortSignal,
  ): Promise<BinanceTickerBatchResult>;
};

export type BinanceMarketDataClientOptions = {
  fetch?: typeof globalThis.fetch;
  baseUrl?: string;
  timeoutMs?: number;
};

export function createBinanceMarketDataClient(
  options: BinanceMarketDataClientOptions = {},
): BinanceMarketDataClient {
  const fetchImpl = options.fetch ?? globalThis.fetch;
  const baseUrl = options.baseUrl ?? BINANCE_MARKET_DATA_BASE_URL;
  const timeoutMs = options.timeoutMs ?? BINANCE_MARKET_DATA_TIMEOUT_MS;

  return {
    async validateSpotSymbol(assetSymbol, marketSymbol, signal) {
      const response = await requestJson(
        fetchImpl,
        `${baseUrl}/api/v3/exchangeInfo?symbol=${encodeURIComponent(marketSymbol)}`,
        marketSymbol,
        timeoutMs,
        "symbol-validation",
        signal,
      );
      if (!response.ok) {
        return { ok: false, error: response.error };
      }

      const symbols = readExchangeSymbols(response.value);
      if (!symbols || symbols.length !== 1) {
        return {
          ok: false,
          error: failure(
            symbols?.length === 0
              ? "BINANCE_SYMBOL_MISSING"
              : "BINANCE_MALFORMED_RESPONSE",
            marketSymbol,
            "exchangeInfo did not return exactly one symbol",
          ),
        };
      }

      const symbol = symbols[0];
      if (symbol.symbol !== marketSymbol) {
        return {
          ok: false,
          error: failure(
            "BINANCE_SYMBOL_MISSING",
            marketSymbol,
            "exchangeInfo symbol does not match the requested symbol",
          ),
        };
      }
      if (symbol.status !== "TRADING") {
        return {
          ok: false,
          error: failure(
            "BINANCE_SYMBOL_NOT_TRADING",
            marketSymbol,
            "Binance symbol is not in TRADING status",
          ),
        };
      }
      if (symbol.baseAsset !== assetSymbol) {
        return {
          ok: false,
          error: failure(
            "BINANCE_BASE_ASSET_MISMATCH",
            marketSymbol,
            `Expected base asset ${assetSymbol}, received ${symbol.baseAsset}`,
          ),
        };
      }
      if (symbol.quoteAsset !== "USDT") {
        return {
          ok: false,
          error: failure(
            "BINANCE_QUOTE_ASSET_MISMATCH",
            marketSymbol,
            `Expected USDT quote asset, received ${symbol.quoteAsset}`,
          ),
        };
      }
      if (!symbol.isSpotTradingAllowed) {
        return {
          ok: false,
          error: failure(
            "BINANCE_SPOT_NOT_ALLOWED",
            marketSymbol,
            "Binance symbol is not enabled for Spot trading",
          ),
        };
      }

      return { ok: true, value: symbol };
    },

    async fetchLatestPrices(symbols, signal) {
      const requestedSymbols = Array.from(new Set(symbols));
      if (requestedSymbols.length === 0) {
        return { prices: [], failures: [] };
      }

      const query = encodeURIComponent(JSON.stringify(requestedSymbols));
      const response = await requestJson(
        fetchImpl,
        `${baseUrl}/api/v3/ticker/price?symbols=${query}`,
        requestedSymbols.join(","),
        timeoutMs,
        "ticker",
        signal,
      );
      if (!response.ok) {
        return {
          prices: [],
          failures: requestedSymbols.map((symbol) => ({
            ...response.error,
            symbol,
          })),
        };
      }

      if (!Array.isArray(response.value)) {
        return {
          prices: [],
          failures: requestedSymbols.map((symbol) =>
            failure(
              "BINANCE_MALFORMED_RESPONSE",
              symbol,
              "Ticker response must be an array",
            ),
          ),
        };
      }

      const rowsBySymbol = new Map<string, string[]>();
      for (const row of response.value) {
        if (!isRecord(row) || typeof row.symbol !== "string") {
          continue;
        }
        const prices = rowsBySymbol.get(row.symbol) ?? [];
        prices.push(typeof row.price === "string" ? row.price : "");
        rowsBySymbol.set(row.symbol, prices);
      }

      const prices: BinanceTickerBatchResult["prices"] = [];
      const failures: BinanceMarketDataFailure[] = [];
      for (const symbol of requestedSymbols) {
        const candidates = rowsBySymbol.get(symbol);
        if (!candidates) {
          failures.push(
            failure(
              "BINANCE_SYMBOL_MISSING",
              symbol,
              "Ticker response omitted the requested symbol",
            ),
          );
          continue;
        }
        if (candidates.length !== 1) {
          failures.push(
            failure(
              "BINANCE_SYMBOL_DUPLICATE",
              symbol,
              "Ticker response returned a duplicate symbol",
            ),
          );
          continue;
        }

        const price = candidates[0];
        try {
          if (!DECIMAL_STRING_PATTERN.test(price) || !isPositive(price)) {
            throw new Error("Price must be positive");
          }
          prices.push({ symbol, price });
        } catch {
          failures.push(
            failure(
              "BINANCE_INVALID_PRICE",
              symbol,
              "Ticker price must be a positive finite decimal",
            ),
          );
        }
      }

      return { prices, failures };
    },
  };
}

type JsonRequestResult =
  | { ok: true; value: unknown }
  | { ok: false; error: BinanceMarketDataFailure };

type JsonRequestContext = "symbol-validation" | "ticker";

async function requestJson(
  fetchImpl: typeof globalThis.fetch,
  url: string,
  symbol: string,
  timeoutMs: number,
  context: JsonRequestContext,
  externalSignal?: AbortSignal,
): Promise<JsonRequestResult> {
  const controller = new AbortController();
  let timedOut = false;
  const timeoutId = globalThis.setTimeout(() => {
    timedOut = true;
    controller.abort();
  }, timeoutMs);
  const abortFromExternal = () => controller.abort();
  externalSignal?.addEventListener("abort", abortFromExternal, { once: true });

  try {
    const response = await fetchImpl(url, {
      method: "GET",
      headers: { Accept: "application/json" },
      signal: controller.signal,
    });
    if (!response.ok) {
      return {
        ok: false,
        error: {
          ...failure(
            response.status === 418 || response.status === 429
              ? "BINANCE_RATE_LIMITED"
              : "BINANCE_HTTP_ERROR",
            symbol,
            `Binance request failed with HTTP ${response.status}`,
          ),
          httpStatus: response.status,
        },
      };
    }

    try {
      return { ok: true, value: await response.json() };
    } catch {
      return {
        ok: false,
        error: failure(
          "BINANCE_MALFORMED_RESPONSE",
          symbol,
          "Binance response was not valid JSON",
        ),
      };
    }
  } catch {
    return {
      ok: false,
      error: failure(
        timedOut
          ? "BINANCE_TIMEOUT"
          : externalSignal?.aborted
            ? "BINANCE_ABORTED"
            : context === "symbol-validation"
              ? "BINANCE_VALIDATION_UNAVAILABLE"
              : "BINANCE_NETWORK_ERROR",
        symbol,
        timedOut
          ? `Binance request timed out after ${timeoutMs} ms`
          : externalSignal?.aborted
            ? "Binance request was cancelled"
            : context === "symbol-validation"
              ? "Binance symbol validation failed before a readable response arrived"
              : "Binance request failed before a response arrived",
      ),
    };
  } finally {
    globalThis.clearTimeout(timeoutId);
    externalSignal?.removeEventListener("abort", abortFromExternal);
  }
}

function readExchangeSymbols(value: unknown): BinanceExchangeSymbol[] | undefined {
  if (!isRecord(value) || !Array.isArray(value.symbols)) {
    return undefined;
  }

  const symbols: BinanceExchangeSymbol[] = [];
  for (const item of value.symbols) {
    if (
      !isRecord(item) ||
      typeof item.symbol !== "string" ||
      typeof item.status !== "string" ||
      typeof item.baseAsset !== "string" ||
      typeof item.quoteAsset !== "string"
    ) {
      return undefined;
    }

    const permissions = Array.isArray(item.permissions)
      ? item.permissions
      : [];
    symbols.push({
      symbol: item.symbol,
      status: item.status,
      baseAsset: item.baseAsset,
      quoteAsset: item.quoteAsset,
      isSpotTradingAllowed:
        item.isSpotTradingAllowed === true || permissions.includes("SPOT"),
    });
  }
  return symbols;
}

function failure(
  code: BinanceMarketDataFailure["code"],
  symbol: string,
  message: string,
): BinanceMarketDataFailure {
  return { code, symbol, message };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
