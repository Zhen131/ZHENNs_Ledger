import { afterEach, describe, expect, it, vi } from "vitest";

import {
  BINANCE_MARKET_DATA_BASE_URL,
  BINANCE_MARKET_DATA_TIMEOUT_MS,
  createBinanceMarketDataClient,
} from "./binanceMarketDataClient";

afterEach(() => {
  vi.useRealTimers();
});

function jsonResponse(value: unknown, status = 200): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: vi.fn(async () => value),
  } as unknown as Response;
}

function exchangeInfo(overrides: Record<string, unknown> = {}) {
  return {
    symbols: [
      {
        symbol: "BTCUSDT",
        status: "TRADING",
        baseAsset: "BTC",
        quoteAsset: "USDT",
        isSpotTradingAllowed: true,
        ...overrides,
      },
    ],
  };
}

describe("Binance market data client", () => {
  it("uses only the public data host without credentials", async () => {
    const fetchMock = vi.fn(
      async (input: RequestInfo | URL, init?: RequestInit) => {
        void input;
        void init;
        return jsonResponse(exchangeInfo());
      },
    );
    const client = createBinanceMarketDataClient({ fetch: fetchMock });

    await expect(client.validateSpotSymbol("BTC", "BTCUSDT")).resolves.toEqual(
      expect.objectContaining({ ok: true }),
    );
    expect(fetchMock).toHaveBeenCalledOnce();
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe(
      `${BINANCE_MARKET_DATA_BASE_URL}/api/v3/exchangeInfo?symbol=BTCUSDT`,
    );
    expect(init).toEqual(
      expect.objectContaining({
        method: "GET",
        headers: { Accept: "application/json" },
      }),
    );
    expect(JSON.stringify(init)).not.toMatch(/api.?key|authorization/i);
  });

  it.each([
    [{ status: "BREAK" }, "BINANCE_SYMBOL_NOT_TRADING"],
    [{ baseAsset: "ETH" }, "BINANCE_BASE_ASSET_MISMATCH"],
    [{ quoteAsset: "BUSD" }, "BINANCE_QUOTE_ASSET_MISMATCH"],
    [{ isSpotTradingAllowed: false }, "BINANCE_SPOT_NOT_ALLOWED"],
  ])("rejects invalid exchangeInfo contracts", async (overrides, code) => {
    const client = createBinanceMarketDataClient({
      fetch: vi.fn(async () => jsonResponse(exchangeInfo(overrides))),
    });
    const result = await client.validateSpotSymbol("BTC", "BTCUSDT");
    expect(result).toEqual({
      ok: false,
      error: expect.objectContaining({ code }),
    });
  });

  it.each([
    [{ symbols: [] }, "BINANCE_SYMBOL_MISSING"],
    [
      { symbols: [...exchangeInfo().symbols, ...exchangeInfo().symbols] },
      "BINANCE_MALFORMED_RESPONSE",
    ],
    [{ symbols: [{ symbol: "BTCUSDT" }] }, "BINANCE_MALFORMED_RESPONSE"],
    [
      exchangeInfo({ symbol: "ETHUSDT" }),
      "BINANCE_SYMBOL_MISSING",
    ],
  ])("rejects missing, duplicate, or malformed exchangeInfo", async (body, code) => {
    const client = createBinanceMarketDataClient({
      fetch: vi.fn(async () => jsonResponse(body)),
    });
    await expect(
      client.validateSpotSymbol("BTC", "BTCUSDT"),
    ).resolves.toEqual({
      ok: false,
      error: expect.objectContaining({ code }),
    });
  });

  it("parses a requested batch and reports missing, duplicate, zero and malformed prices", async () => {
    const client = createBinanceMarketDataClient({
      fetch: vi.fn(async () =>
        jsonResponse([
          { symbol: "BTCUSDT", price: "70000.1" },
          { symbol: "ETHUSDT", price: "2000" },
          { symbol: "ETHUSDT", price: "2001" },
          { symbol: "ADAUSDT", price: "0" },
        ]),
      ),
    });

    const result = await client.fetchLatestPrices([
      "BTCUSDT",
      "ETHUSDT",
      "ADAUSDT",
      "SOLUSDT",
    ]);
    expect(result.prices).toEqual([
      { symbol: "BTCUSDT", price: "70000.1" },
    ]);
    expect(result.failures).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          symbol: "ETHUSDT",
          code: "BINANCE_SYMBOL_DUPLICATE",
        }),
        expect.objectContaining({
          symbol: "ADAUSDT",
          code: "BINANCE_INVALID_PRICE",
        }),
        expect.objectContaining({
          symbol: "SOLUSDT",
          code: "BINANCE_SYMBOL_MISSING",
        }),
      ]),
    );
  });

  it.each(["-1", "NaN", "Infinity", " 1", "1e3"])(
    "rejects the invalid ticker price %s",
    async (price) => {
      const client = createBinanceMarketDataClient({
        fetch: vi.fn(async () =>
          jsonResponse([{ symbol: "BTCUSDT", price }]),
        ),
      });
      await expect(client.fetchLatestPrices(["BTCUSDT"])).resolves.toEqual({
        prices: [],
        failures: [
          expect.objectContaining({ code: "BINANCE_INVALID_PRICE" }),
        ],
      });
    },
  );

  it.each([
    [418, "BINANCE_RATE_LIMITED"],
    [429, "BINANCE_RATE_LIMITED"],
    [500, "BINANCE_HTTP_ERROR"],
  ])("maps HTTP %i to a safe batch failure", async (status, code) => {
    const client = createBinanceMarketDataClient({
      fetch: vi.fn(async () => jsonResponse({}, status)),
    });
    const result = await client.fetchLatestPrices(["BTCUSDT"]);
    expect(result.prices).toEqual([]);
    expect(result.failures[0]).toEqual(
      expect.objectContaining({ code, httpStatus: status }),
    );
  });

  it("times out once after eight seconds without retrying", async () => {
    vi.useFakeTimers();
    const fetchMock = vi.fn(
      (_url: string | URL | Request, init?: RequestInit) =>
        new Promise<Response>((_resolve, reject) => {
          init?.signal?.addEventListener("abort", () =>
            reject(new DOMException("aborted", "AbortError")),
          );
        }),
    );
    const client = createBinanceMarketDataClient({ fetch: fetchMock });
    const request = client.fetchLatestPrices(["BTCUSDT"]);

    await vi.advanceTimersByTimeAsync(BINANCE_MARKET_DATA_TIMEOUT_MS);
    await expect(request).resolves.toEqual({
      prices: [],
      failures: [
        expect.objectContaining({
          code: "BINANCE_TIMEOUT",
          symbol: "BTCUSDT",
        }),
      ],
    });
    expect(fetchMock).toHaveBeenCalledOnce();
  });

  it("reports abort, network and malformed JSON without throwing", async () => {
    const abortController = new AbortController();
    const abortFetch = vi.fn(
      (_url: string | URL | Request, init?: RequestInit) =>
        new Promise<Response>((_resolve, reject) => {
          init?.signal?.addEventListener("abort", () =>
            reject(new DOMException("aborted", "AbortError")),
          );
        }),
    );
    const abortedClient = createBinanceMarketDataClient({ fetch: abortFetch });
    const abortedRequest = abortedClient.fetchLatestPrices(
      ["BTCUSDT"],
      abortController.signal,
    );
    abortController.abort();
    await expect(abortedRequest).resolves.toEqual({
      prices: [],
      failures: [
        expect.objectContaining({ code: "BINANCE_ABORTED" }),
      ],
    });

    const networkClient = createBinanceMarketDataClient({
      fetch: vi.fn(async () => {
        throw new TypeError("offline");
      }),
    });
    expect(
      (await networkClient.fetchLatestPrices(["BTCUSDT"])).failures[0].code,
    ).toBe("BINANCE_NETWORK_ERROR");

    const malformedClient = createBinanceMarketDataClient({
      fetch: vi.fn(async () => ({
        ok: true,
        status: 200,
        json: vi.fn(async () => {
          throw new SyntaxError("bad json");
        }),
      } as unknown as Response)),
    });
    expect(
      (await malformedClient.fetchLatestPrices(["BTCUSDT"])).failures[0].code,
    ).toBe("BINANCE_MALFORMED_RESPONSE");
  });
});
