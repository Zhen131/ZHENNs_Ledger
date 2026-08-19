// @vitest-environment jsdom

import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import type { ApplyLedgerActionResult } from "@/app";
import type { LedgerData } from "@/core/models";
import type { LedgerClock, LedgerTimeSnapshot } from "@/core/shared";
import { createInitialLedgerData } from "@/core/state";
import type {
  BinanceMarketDataClient,
  BinanceSymbolValidationResult,
  BinanceTickerBatchResult,
} from "@/platform/integrations";
import { createSimpleTrade } from "@/test-support";
import { MarketDataControls } from "./MarketDataControls";

afterEach(cleanup);

const clock: LedgerClock = {
  now: () => new Date("2026-07-25T12:00:00Z"),
};

type Harness = {
  ledgerData: LedgerData;
  applyLedgerMutation: ReturnType<typeof vi.fn<ApplyMutation>>;
};

type ApplyMutation = (
  mutation: (current: LedgerData) => LedgerData,
  timeSnapshot?: LedgerTimeSnapshot,
) => ApplyLedgerActionResult;

function createHarness(initial: LedgerData): Harness {
  const harness: Harness = {
    ledgerData: initial,
    applyLedgerMutation: vi.fn<ApplyMutation>(),
  };
  harness.applyLedgerMutation.mockImplementation(
    (mutation: (current: LedgerData) => LedgerData) => {
      const next = mutation(harness.ledgerData);
      if (next === harness.ledgerData) return "noop" as const;
      harness.ledgerData = next;
      return "applied" as const;
    },
  );
  return harness;
}

function createClient(
  overrides: Partial<BinanceMarketDataClient> = {},
): BinanceMarketDataClient {
  return {
    validateSpotSymbol: vi.fn(async (assetSymbol, symbol) => ({
      ok: true as const,
      value: {
        symbol,
        status: "TRADING",
        baseAsset: assetSymbol,
        quoteAsset: "USDT",
        isSpotTradingAllowed: true,
      },
    })),
    fetchLatestPrices: vi.fn(async (symbols: readonly string[]) => ({
      prices: symbols.map((symbol) => ({ symbol, price: "70000" })),
      failures: [],
    })),
    ...overrides,
  };
}

function addSol(
  ledgerData: LedgerData,
  mapped = false,
): LedgerData {
  return {
    ...ledgerData,
    assets: [
      ...ledgerData.assets,
      {
        id: "asset-sol",
        symbol: "SOL",
        name: "SOL",
        quoteCurrency: "USDT",
        binanceMapping: mapped
          ? {
              provider: "binance",
              symbol: "SOLUSDT",
              baseAsset: "SOL",
              quoteAsset: "USDT",
            }
          : null,
        createdAt: "2026-07-25T00:00:00.000Z",
        updatedAt: "2026-07-25T00:00:00.000Z",
      },
    ],
  };
}

function withBtcHolding(ledgerData = createInitialLedgerData()): LedgerData {
  return {
    ...ledgerData,
    trades: [
      createSimpleTrade("btc-buy", "buy", "BTC", "1", "2026-07-20"),
    ],
  };
}

function controls(
  harness: Harness,
  client: BinanceMarketDataClient,
  overrides: {
    ledgerEpoch?: number;
    sessionGeneration?: number;
    mutationVersion?: number;
    persistedVersion?: number;
    persistenceStatus?: "idle" | "saving" | "saved" | "error";
    isWritable?: boolean;
    showRefresh?: boolean;
    compactMappings?: boolean;
  } = {},
) {
  return (
    <MarketDataControls
      applyLedgerMutation={harness.applyLedgerMutation}
      client={client}
      clock={clock}
      compactMappings={overrides.compactMappings}
      expandMappings
      generateId={() => "api-price-id"}
      isWritable={overrides.isWritable ?? true}
      ledgerData={harness.ledgerData}
      ledgerEpoch={overrides.ledgerEpoch ?? 1}
      mode="auto"
      mutationVersion={overrides.mutationVersion ?? 0}
      onModeChange={vi.fn()}
      persistedVersion={overrides.persistedVersion ?? 0}
      persistenceStatus={overrides.persistenceStatus ?? "saved"}
      sessionGeneration={overrides.sessionGeneration ?? 11}
      showRefresh={overrides.showRefresh}
      todayKey="2026-07-25"
    />
  );
}

function mappingRow(symbol: string): HTMLElement {
  const input = screen.getByLabelText(`${symbol} Binance 交易对`);
  const row = input.parentElement;
  if (!row) throw new Error(`Missing ${symbol} mapping row`);
  return row;
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((accept) => {
    resolve = accept;
  });
  return { promise, resolve };
}

function validSymbol(
  assetSymbol: string,
  symbol: string,
): BinanceSymbolValidationResult {
  return {
    ok: true,
    value: {
      symbol,
      status: "TRADING",
      baseAsset: assetSymbol,
      quoteAsset: "USDT",
      isSpotTradingAllowed: true,
    },
  };
}

describe("MarketDataControls", () => {
  it("never contacts Binance on mount, hydrate-like rerender, navigation remount, or epoch change", async () => {
    const client = createClient();
    const harness = createHarness(withBtcHolding());
    const view = render(controls(harness, client));

    await act(async () => undefined);
    view.rerender(controls(harness, client, { ledgerEpoch: 2 }));
    await act(async () => undefined);
    view.unmount();
    render(controls(harness, client, { ledgerEpoch: 2 }));
    await act(async () => undefined);

    expect(client.validateSpotSymbol).not.toHaveBeenCalled();
    expect(client.fetchLatestPrices).not.toHaveBeenCalled();
    expect(harness.applyLedgerMutation).not.toHaveBeenCalled();
    expect(screen.getByText("尚未主动刷新 Binance 行情。")).toBeTruthy();
  });

  it("rejects invalid symbol input locally with zero network or mutation", async () => {
    const client = createClient();
    const harness = createHarness(addSol(createInitialLedgerData()));
    render(controls(harness, client, { showRefresh: false }));
    const row = mappingRow("SOL");

    fireEvent.change(screen.getByLabelText("SOL Binance 交易对"), {
      target: { value: "SOL-USDT" },
    });
    fireEvent.click(within(row).getByRole("button", { name: "验证并保存" }));

    await waitFor(() => {
      expect(screen.getByText(/BINANCE_INVALID_SYMBOL_INPUT/)).toBeTruthy();
    });
    expect(client.validateSpotSymbol).not.toHaveBeenCalled();
    expect(client.fetchLatestPrices).not.toHaveBeenCalled();
    expect(harness.applyLedgerMutation).not.toHaveBeenCalled();
  });

  it("reports unreadable symbol validation honestly without changing local facts or requesting ticker", async () => {
    const validateSpotSymbol = vi.fn(async () => ({
      ok: false as const,
      error: {
        code: "BINANCE_VALIDATION_UNAVAILABLE" as const,
        symbol: "SOLUSDT",
        message: "Symbol validation failed before a readable response arrived",
      },
    }));
    const client = createClient({ validateSpotSymbol });
    const initial = addSol(createInitialLedgerData());
    initial.trades = [
      createSimpleTrade("sol-local-trade", "buy", "SOL", "2", "2026-07-20"),
    ];
    initial.priceSnapshots = [
      {
        id: "sol-manual-price",
        assetSymbol: "SOL",
        price: "125",
        currency: "USDT",
        recordedAt: "2026-07-24",
        source: "manual",
        createdAt: "2026-07-24T00:00:00Z",
        updatedAt: "2026-07-24T00:00:00Z",
      },
    ];
    const before = structuredClone(initial);
    const harness = createHarness(initial);
    render(controls(harness, client, { showRefresh: false }));
    const row = mappingRow("SOL");

    fireEvent.change(screen.getByLabelText("SOL Binance 交易对"), {
      target: { value: "SOL" },
    });
    fireEvent.click(within(row).getByRole("button", { name: "验证并保存" }));

    await waitFor(() => {
      expect(
        screen.getByText(
          /BINANCE_VALIDATION_UNAVAILABLE · 当前无法验证该 Binance 交易对。该交易对可能不存在，也可能是 Binance 的错误响应无法被浏览器读取，或当前网络／服务暂时不可用。本地资产、历史交易和手动价格均未改变，可以继续使用手动价格或稍后重试。/,
        ),
      ).toBeTruthy();
    });
    expect(validateSpotSymbol).toHaveBeenCalledOnce();
    expect(validateSpotSymbol).toHaveBeenCalledWith(
      "SOL",
      "SOLUSDT",
      expect.any(AbortSignal),
    );
    expect(client.fetchLatestPrices).not.toHaveBeenCalled();
    expect(harness.applyLedgerMutation).not.toHaveBeenCalled();
    expect(harness.ledgerData).toEqual(before);
  });

  it("persists an explicit SOL mapping before requesting and persisting its first price", async () => {
    const client = createClient();
    const harness = createHarness(addSol(createInitialLedgerData()));
    const view = render(controls(harness, client, { showRefresh: false }));
    const row = mappingRow("SOL");

    fireEvent.change(screen.getByLabelText("SOL Binance 交易对"), {
      target: { value: " sol " },
    });
    fireEvent.click(within(row).getByRole("button", { name: "验证并保存" }));

    await waitFor(() => {
      expect(harness.applyLedgerMutation).toHaveBeenCalledTimes(1);
    });
    expect(client.validateSpotSymbol).toHaveBeenCalledWith(
      "SOL",
      "SOLUSDT",
      expect.any(AbortSignal),
    );
    expect(client.fetchLatestPrices).not.toHaveBeenCalled();
    expect(harness.ledgerData.assets.at(-1)?.binanceMapping?.symbol).toBe(
      "SOLUSDT",
    );

    view.rerender(
      controls(harness, client, {
        showRefresh: false,
        mutationVersion: 1,
        persistedVersion: 1,
      }),
    );
    await waitFor(() => {
      expect(client.fetchLatestPrices).toHaveBeenCalledWith(
        ["SOLUSDT"],
        expect.any(AbortSignal),
      );
      expect(harness.applyLedgerMutation).toHaveBeenCalledTimes(2);
    });
    expect(harness.ledgerData.priceSnapshots).toEqual([
      expect.objectContaining({
        assetSymbol: "SOL",
        price: "70000",
        source: "api",
      }),
    ]);

    view.rerender(
      controls(harness, client, {
        showRefresh: false,
        mutationVersion: 2,
        persistedVersion: 2,
      }),
    );
    await waitFor(() => {
      expect(screen.getByText("映射与首次价格均已保存。")).toBeTruthy();
    });
  });

  it("keeps a persisted mapping and old prices when the first ticker request fails", async () => {
    const client = createClient({
      fetchLatestPrices: vi.fn(async () => ({
        prices: [],
        failures: [
          {
            code: "BINANCE_NETWORK_ERROR" as const,
            symbol: "SOLUSDT",
            message: "offline",
          },
        ],
      })),
    });
    const initial = addSol(createInitialLedgerData());
    initial.priceSnapshots = [
      {
        id: "old-sol-price",
        assetSymbol: "SOL",
        price: "100",
        currency: "USDT",
        recordedAt: "2026-07-24",
        source: "manual",
        createdAt: "2026-07-24T00:00:00Z",
        updatedAt: "2026-07-24T00:00:00Z",
      },
    ];
    const harness = createHarness(initial);
    const view = render(controls(harness, client, { showRefresh: false }));
    const row = mappingRow("SOL");

    fireEvent.change(screen.getByLabelText("SOL Binance 交易对"), {
      target: { value: "SOLUSDT" },
    });
    fireEvent.click(within(row).getByRole("button", { name: "验证并保存" }));
    await waitFor(() => expect(harness.applyLedgerMutation).toHaveBeenCalledOnce());

    view.rerender(
      controls(harness, client, {
        showRefresh: false,
        mutationVersion: 1,
        persistedVersion: 1,
      }),
    );
    await waitFor(() => {
      expect(
        screen.getByText(/映射已保存；首次价格失败：BINANCE_NETWORK_ERROR/),
      ).toBeTruthy();
    });
    expect(harness.ledgerData.assets.at(-1)?.binanceMapping?.symbol).toBe(
      "SOLUSDT",
    );
    expect(harness.ledgerData.priceSnapshots.map(({ id }) => id)).toEqual([
      "old-sol-price",
    ]);
    expect(harness.applyLedgerMutation).toHaveBeenCalledOnce();
  });

  it("aborts a repeated search and ignores its late signal-insensitive result", async () => {
    const first = deferred<BinanceSymbolValidationResult>();
    let firstSignal: AbortSignal | undefined;
    const validateSpotSymbol = vi.fn(
      (assetSymbol: string, symbol: string, signal?: AbortSignal) => {
        if (validateSpotSymbol.mock.calls.length === 1) {
          firstSignal = signal;
          return first.promise;
        }
        return Promise.resolve(validSymbol(assetSymbol, symbol));
      },
    );
    const client = createClient({ validateSpotSymbol });
    const harness = createHarness(addSol(createInitialLedgerData()));
    render(controls(harness, client, { showRefresh: false }));
    const row = mappingRow("SOL");
    const input = screen.getByLabelText("SOL Binance 交易对");

    fireEvent.change(input, { target: { value: "SOLUSDC" } });
    fireEvent.click(within(row).getByRole("button", { name: "验证并保存" }));
    fireEvent.change(input, { target: { value: "SOLUSDT" } });
    fireEvent.click(within(row).getByRole("button", { name: "验证并保存" }));

    await waitFor(() => expect(harness.applyLedgerMutation).toHaveBeenCalledOnce());
    expect(firstSignal?.aborted).toBe(true);
    expect(harness.ledgerData.assets.at(-1)?.binanceMapping?.symbol).toBe(
      "SOLUSDT",
    );

    await act(async () => {
      first.resolve(validSymbol("SOL", "SOLUSDC"));
      await first.promise;
    });
    expect(harness.applyLedgerMutation).toHaveBeenCalledOnce();
    expect(harness.ledgerData.assets.at(-1)?.binanceMapping?.symbol).toBe(
      "SOLUSDT",
    );
    expect(screen.getByText("交易对已验证；正在保存映射。")).toBeTruthy();
  });

  it("drops validation after a session generation change and aborts on unmount", async () => {
    const first = deferred<BinanceSymbolValidationResult>();
    let signal: AbortSignal | undefined;
    const client = createClient({
      validateSpotSymbol: vi.fn((_asset, _symbol, requestSignal) => {
        signal = requestSignal;
        return first.promise;
      }),
    });
    const harness = createHarness(addSol(createInitialLedgerData()));
    const view = render(controls(harness, client, { showRefresh: false }));
    const row = mappingRow("SOL");

    fireEvent.change(screen.getByLabelText("SOL Binance 交易对"), {
      target: { value: "SOL" },
    });
    fireEvent.click(within(row).getByRole("button", { name: "验证并保存" }));
    view.rerender(
      controls(harness, client, {
        showRefresh: false,
        sessionGeneration: 12,
      }),
    );
    expect(signal?.aborted).toBe(true);

    await act(async () => {
      first.resolve(validSymbol("SOL", "SOLUSDT"));
      await first.promise;
    });
    expect(harness.applyLedgerMutation).not.toHaveBeenCalled();
    view.unmount();

    const second = deferred<BinanceSymbolValidationResult>();
    const secondClient = createClient({
      validateSpotSymbol: vi.fn(() => second.promise),
    });
    const secondView = render(
      controls(harness, secondClient, {
        showRefresh: false,
        sessionGeneration: 12,
      }),
    );
    const secondRow = mappingRow("SOL");
    fireEvent.change(screen.getByLabelText("SOL Binance 交易对"), {
      target: { value: "SOL" },
    });
    fireEvent.click(
      within(secondRow).getByRole("button", { name: "验证并保存" }),
    );
    secondView.unmount();
    await act(async () => {
      second.resolve(validSymbol("SOL", "SOLUSDT"));
      await second.promise;
    });
    expect(harness.applyLedgerMutation).not.toHaveBeenCalled();
  });

  it("drops an in-flight ticker after the mapping is deleted externally", async () => {
    const ticker = deferred<BinanceTickerBatchResult>();
    let tickerSignal: AbortSignal | undefined;
    const client = createClient({
      fetchLatestPrices: vi.fn((_symbols, signal) => {
        tickerSignal = signal;
        return ticker.promise;
      }),
    });
    const harness = createHarness(createInitialLedgerData());
    const view = render(controls(harness, client, { showRefresh: false }));
    const btcRow = mappingRow("BTC");

    fireEvent.click(within(btcRow).getByRole("button", { name: "刷新该资产" }));
    await waitFor(() => expect(client.fetchLatestPrices).toHaveBeenCalledOnce());

    harness.ledgerData = {
      ...harness.ledgerData,
      assets: harness.ledgerData.assets.map((asset) =>
        asset.symbol === "BTC" ? { ...asset, binanceMapping: null } : asset,
      ),
    };
    view.rerender(controls(harness, client, { showRefresh: false }));
    expect(tickerSignal?.aborted).toBe(true);

    await act(async () => {
      ticker.resolve({
        prices: [{ symbol: "BTCUSDT", price: "70000" }],
        failures: [],
      });
      await ticker.promise;
    });
    expect(harness.applyLedgerMutation).not.toHaveBeenCalled();
    expect(harness.ledgerData.priceSnapshots).toEqual([]);
  });

  it("refreshes one explicitly selected mapped asset even without a position", async () => {
    const client = createClient();
    const harness = createHarness(addSol(createInitialLedgerData(), true));
    const view = render(controls(harness, client));
    const row = mappingRow("SOL");

    expect(
      (screen.getByRole("button", {
        name: "刷新已映射非零持仓",
      }) as HTMLButtonElement).disabled,
    ).toBe(true);
    fireEvent.click(within(row).getByRole("button", { name: "刷新该资产" }));

    await waitFor(() => expect(harness.applyLedgerMutation).toHaveBeenCalledOnce());
    expect(client.validateSpotSymbol).toHaveBeenCalledTimes(1);
    expect(client.validateSpotSymbol).toHaveBeenCalledWith(
      "SOL",
      "SOLUSDT",
      expect.any(AbortSignal),
    );
    expect(client.fetchLatestPrices).toHaveBeenCalledWith(
      ["SOLUSDT"],
      expect.any(AbortSignal),
    );

    view.rerender(
      controls(harness, client, {
        mutationVersion: 1,
        persistedVersion: 1,
      }),
    );
    await waitFor(() => {
      expect(screen.getByText("该资产行情已保存。")).toBeTruthy();
    });
  });

  it("refreshes only mapped nonzero holdings after the explicit global click", async () => {
    const client = createClient();
    const harness = createHarness(withBtcHolding());
    const view = render(controls(harness, client));

    expect(client.validateSpotSymbol).not.toHaveBeenCalled();
    fireEvent.click(
      screen.getByRole("button", { name: "刷新已映射非零持仓" }),
    );
    await waitFor(() => expect(harness.applyLedgerMutation).toHaveBeenCalledOnce());

    expect(client.validateSpotSymbol).toHaveBeenCalledTimes(1);
    expect(client.validateSpotSymbol).toHaveBeenCalledWith(
      "BTC",
      "BTCUSDT",
      expect.any(AbortSignal),
    );
    expect(client.fetchLatestPrices).toHaveBeenCalledWith(
      ["BTCUSDT"],
      expect.any(AbortSignal),
    );

    view.rerender(
      controls(harness, client, {
        mutationVersion: 1,
        persistedVersion: 1,
      }),
    );
    await waitFor(() => {
      expect(screen.getByText("已保存 1 项，失败 0 项。")).toBeTruthy();
    });
  });

  it("deletes only the mapping after explicit confirmation and preserves price facts", () => {
    const initial = createInitialLedgerData();
    initial.priceSnapshots = [
      {
        id: "btc-history",
        assetSymbol: "BTC",
        price: "68000",
        currency: "USDT",
        recordedAt: "2026-07-24",
        source: "manual",
        createdAt: "2026-07-24T00:00:00Z",
        updatedAt: "2026-07-24T00:00:00Z",
      },
    ];
    const client = createClient();
    const harness = createHarness(initial);
    render(controls(harness, client, { showRefresh: false }));
    const remove = within(mappingRow("BTC")).getByRole("button", {
      name: "删除 BTC Binance 映射",
    });

    fireEvent.click(remove);
    expect(harness.applyLedgerMutation).not.toHaveBeenCalled();
    fireEvent.click(remove);

    expect(harness.applyLedgerMutation).toHaveBeenCalledOnce();
    expect(harness.ledgerData.assets[0].binanceMapping).toBeNull();
    expect(harness.ledgerData.priceSnapshots.map(({ id }) => id)).toEqual([
      "btc-history",
    ]);
    expect(client.validateSpotSymbol).not.toHaveBeenCalled();
    expect(client.fetchLatestPrices).not.toHaveBeenCalled();
  });
});
