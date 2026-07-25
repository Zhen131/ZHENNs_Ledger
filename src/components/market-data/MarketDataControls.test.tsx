// @vitest-environment jsdom

import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import type { BinanceMarketDataClient } from "../../marketData/binanceMarketDataClient";
import type { LedgerData } from "../../models";
import { createInitialLedgerData } from "../../state/initialLedgerData";
import { createSimpleTrade } from "../../test/fixtures";
import type { LedgerClock } from "../../utils/ledgerDate";
import { MarketDataControls } from "./MarketDataControls";

afterEach(cleanup);

const clock: LedgerClock = {
  now: () => new Date("2026-07-25T12:00:00Z"),
  todayKey: () => "2026-07-25",
};

function createClient(
  overrides: Partial<BinanceMarketDataClient> = {},
): BinanceMarketDataClient {
  return {
    validateSpotSymbol: vi.fn(async (assetSymbol, symbol) => ({
      ok: true,
      value: {
        symbol,
        status: "TRADING",
        baseAsset: assetSymbol,
        quoteAsset: "USDT",
        isSpotTradingAllowed: true,
      },
    })),
    fetchLatestPrices: vi.fn(async () => ({
      prices: [{ symbol: "BTCUSDT", price: "70000" }],
      failures: [],
    })),
    ...overrides,
  };
}

function createLedgerWithBtc(): LedgerData {
  const ledgerData = createInitialLedgerData();
  ledgerData.trades = [
    createSimpleTrade("btc-buy", "buy", "BTC", "1", "2026-07-20"),
  ];
  return ledgerData;
}

describe("MarketDataControls", () => {
  it("does not auto refresh or allow manual refresh while the ledger is not writable", async () => {
    const client = createClient();
    render(
      <MarketDataControls
        applyLedgerMutation={vi.fn(() => "rejected")}
        client={client}
        clock={clock}
        isWritable={false}
        ledgerData={createLedgerWithBtc()}
        ledgerEpoch={1}
        mode="auto"
        onModeChange={vi.fn()}
      />,
    );

    await act(async () => undefined);
    expect(client.validateSpotSymbol).not.toHaveBeenCalled();
    expect(client.fetchLatestPrices).not.toHaveBeenCalled();
    expect(
      (screen.getByRole("button", {
        name: "刷新 Binance 价格",
      }) as HTMLButtonElement).disabled,
    ).toBe(true);
  });

  it("auto refreshes once per mount and applies all successes as one mutation", async () => {
    let latestLedger = createLedgerWithBtc();
    const client = createClient();
    const applyLedgerMutation = vi.fn(
      (mutation: (current: LedgerData) => LedgerData) => {
        const next = mutation(latestLedger);
        if (next === latestLedger) {
          return "noop" as const;
        }
        latestLedger = next;
        return "applied" as const;
      },
    );
    const view = render(
      <MarketDataControls
        applyLedgerMutation={applyLedgerMutation}
        client={client}
        clock={clock}
        generateId={() => "api-btc"}
        isWritable
        ledgerData={latestLedger}
        ledgerEpoch={1}
        mode="auto"
        onModeChange={vi.fn()}
      />,
    );

    await waitFor(() => {
      expect(screen.getByText("已更新 1 项，失败 0 项。")).toBeTruthy();
    });
    expect(client.validateSpotSymbol).toHaveBeenCalledOnce();
    expect(client.fetchLatestPrices).toHaveBeenCalledOnce();
    expect(applyLedgerMutation).toHaveBeenCalledOnce();
    expect(latestLedger.priceSnapshots).toEqual([
      expect.objectContaining({
        id: "api-btc",
        source: "api",
        price: "70000",
        binanceProvenance: expect.objectContaining({
          symbol: "BTCUSDT",
        }),
      }),
    ]);

    view.rerender(
      <MarketDataControls
        applyLedgerMutation={applyLedgerMutation}
        client={client}
        clock={clock}
        generateId={() => "unused"}
        isWritable
        ledgerData={latestLedger}
        ledgerEpoch={1}
        mode="auto"
        onModeChange={vi.fn()}
      />,
    );
    await act(async () => undefined);
    expect(client.fetchLatestPrices).toHaveBeenCalledOnce();
  });

  it("keeps local facts usable and reports a failed refresh without clearing prices", async () => {
    let latestLedger = createLedgerWithBtc();
    latestLedger.priceSnapshots = [
      {
        id: "manual",
        assetSymbol: "BTC",
        price: "68000",
        currency: "USD",
        recordedAt: "2026-07-24",
        source: "manual",
        createdAt: "2026-07-24T00:00:00Z",
        updatedAt: "2026-07-24T00:00:00Z",
      },
    ];
    const client = createClient({
      validateSpotSymbol: vi.fn(async (_assetSymbol, symbol) => ({
        ok: false,
        error: {
          code: "BINANCE_NETWORK_ERROR",
          symbol,
          message: "offline",
        },
      })),
    });
    const applyLedgerMutation = vi.fn(
      (mutation: (current: LedgerData) => LedgerData) => {
        const next = mutation(latestLedger);
        if (next === latestLedger) {
          return "noop" as const;
        }
        latestLedger = next;
        return "applied" as const;
      },
    );
    render(
      <MarketDataControls
        applyLedgerMutation={applyLedgerMutation}
        client={client}
        clock={clock}
        isWritable
        ledgerData={latestLedger}
        ledgerEpoch={1}
        mode="auto"
        onModeChange={vi.fn()}
      />,
    );

    await waitFor(() => {
      expect(screen.getByText("已更新 0 项，失败 1 项。")).toBeTruthy();
    });
    expect(latestLedger.priceSnapshots).toHaveLength(1);
    expect(latestLedger.priceSnapshots[0].id).toBe("manual");
    expect(screen.getByText(/本次刷新失败：offline/)).toBeTruthy();
  });

  it("drops an old response after ledgerEpoch changes", async () => {
    let resolveTicker!: (
      value: Awaited<ReturnType<BinanceMarketDataClient["fetchLatestPrices"]>>,
    ) => void;
    const tickerPromise = new Promise<
      Awaited<ReturnType<BinanceMarketDataClient["fetchLatestPrices"]>>
    >((resolve) => {
      resolveTicker = resolve;
    });
    const client = createClient({
      fetchLatestPrices: vi.fn(() => tickerPromise),
    });
    const ledgerData = createLedgerWithBtc();
    const applyLedgerMutation = vi.fn(() => "applied" as const);
    const view = render(
      <MarketDataControls
        applyLedgerMutation={applyLedgerMutation}
        client={client}
        clock={clock}
        isWritable
        ledgerData={ledgerData}
        ledgerEpoch={1}
        mode="auto"
        onModeChange={vi.fn()}
      />,
    );

    await waitFor(() => {
      expect(client.fetchLatestPrices).toHaveBeenCalledOnce();
    });
    view.rerender(
      <MarketDataControls
        applyLedgerMutation={applyLedgerMutation}
        client={client}
        clock={clock}
        isWritable
        ledgerData={createInitialLedgerData()}
        ledgerEpoch={2}
        mode="auto"
        onModeChange={vi.fn()}
      />,
    );
    await act(async () => {
      resolveTicker({
        prices: [{ symbol: "BTCUSDT", price: "70000" }],
        failures: [],
      });
      await tickerPromise;
    });
    expect(applyLedgerMutation).not.toHaveBeenCalled();
  });

  it("drops an in-flight response after the mapping signature changes", async () => {
    let resolveTicker!: (
      value: Awaited<ReturnType<BinanceMarketDataClient["fetchLatestPrices"]>>,
    ) => void;
    const tickerPromise = new Promise<
      Awaited<ReturnType<BinanceMarketDataClient["fetchLatestPrices"]>>
    >((resolve) => {
      resolveTicker = resolve;
    });
    const client = createClient({
      fetchLatestPrices: vi.fn(() => tickerPromise),
    });
    const ledgerData = createLedgerWithBtc();
    const applyLedgerMutation = vi.fn(() => "applied" as const);
    const view = render(
      <MarketDataControls
        applyLedgerMutation={applyLedgerMutation}
        client={client}
        clock={clock}
        isWritable
        ledgerData={ledgerData}
        ledgerEpoch={1}
        mode="auto"
        onModeChange={vi.fn()}
      />,
    );

    await waitFor(() => {
      expect(client.fetchLatestPrices).toHaveBeenCalledOnce();
    });
    const changedMappingLedger = structuredClone(ledgerData);
    changedMappingLedger.assets[0].binanceMapping = null;
    view.rerender(
      <MarketDataControls
        applyLedgerMutation={applyLedgerMutation}
        client={client}
        clock={clock}
        isWritable
        ledgerData={changedMappingLedger}
        ledgerEpoch={1}
        mode="auto"
        onModeChange={vi.fn()}
      />,
    );

    await act(async () => {
      resolveTicker({
        prices: [{ symbol: "BTCUSDT", price: "70000" }],
        failures: [],
      });
      await tickerPromise;
    });
    expect(applyLedgerMutation).not.toHaveBeenCalled();
  });

  it("aborts an in-flight response on unmount and never applies it", async () => {
    let requestSignal: AbortSignal | undefined;
    const tickerPromise = new Promise<
      Awaited<ReturnType<BinanceMarketDataClient["fetchLatestPrices"]>>
    >(() => undefined);
    const client = createClient({
      fetchLatestPrices: vi.fn((_symbols, signal) => {
        requestSignal = signal;
        return tickerPromise;
      }),
    });
    const applyLedgerMutation = vi.fn(() => "applied" as const);
    const view = render(
      <MarketDataControls
        applyLedgerMutation={applyLedgerMutation}
        client={client}
        clock={clock}
        isWritable
        ledgerData={createLedgerWithBtc()}
        ledgerEpoch={1}
        mode="auto"
        onModeChange={vi.fn()}
      />,
    );

    await waitFor(() => {
      expect(client.fetchLatestPrices).toHaveBeenCalledOnce();
    });
    view.unmount();

    expect(requestSignal?.aborted).toBe(true);
    expect(applyLedgerMutation).not.toHaveBeenCalled();
  });

  it("merges a response into the latest ledger without overwriting concurrent local facts", async () => {
    let resolveTicker!: (
      value: Awaited<ReturnType<BinanceMarketDataClient["fetchLatestPrices"]>>,
    ) => void;
    const tickerPromise = new Promise<
      Awaited<ReturnType<BinanceMarketDataClient["fetchLatestPrices"]>>
    >((resolve) => {
      resolveTicker = resolve;
    });
    const client = createClient({
      fetchLatestPrices: vi.fn(() => tickerPromise),
    });
    let latestLedger = createLedgerWithBtc();
    const applyLedgerMutation = vi.fn(
      (mutation: (current: LedgerData) => LedgerData) => {
        latestLedger = mutation(latestLedger);
        return "applied" as const;
      },
    );
    render(
      <MarketDataControls
        applyLedgerMutation={applyLedgerMutation}
        client={client}
        clock={clock}
        generateId={() => "api-after-concurrent-write"}
        isWritable
        ledgerData={latestLedger}
        ledgerEpoch={1}
        mode="auto"
        onModeChange={vi.fn()}
      />,
    );

    await waitFor(() => {
      expect(client.fetchLatestPrices).toHaveBeenCalledOnce();
    });
    latestLedger = {
      ...latestLedger,
      trades: [
        ...latestLedger.trades,
        createSimpleTrade(
          "eth-concurrent-buy",
          "buy",
          "ETH",
          "1",
          "2026-07-25",
        ),
      ],
      priceSnapshots: [
        {
          id: "manual-concurrent",
          assetSymbol: "ETH",
          price: "2500",
          currency: "USD",
          recordedAt: "2026-07-25",
          source: "manual",
          createdAt: "2026-07-25T11:59:00Z",
          updatedAt: "2026-07-25T11:59:00Z",
        },
      ],
    };

    await act(async () => {
      resolveTicker({
        prices: [{ symbol: "BTCUSDT", price: "70000" }],
        failures: [],
      });
      await tickerPromise;
    });

    expect(latestLedger.trades.map((trade) => trade.id)).toContain(
      "eth-concurrent-buy",
    );
    expect(
      latestLedger.priceSnapshots.map((snapshot) => snapshot.id),
    ).toEqual(
      expect.arrayContaining([
        "manual-concurrent",
        "api-after-concurrent-write",
      ]),
    );
  });

  it("validates edited mappings online and keeps the mode session-only", async () => {
    let latestLedger = createInitialLedgerData();
    const client = createClient();
    const onModeChange = vi.fn();
    const applyLedgerMutation = vi.fn(
      (mutation: (current: LedgerData) => LedgerData) => {
        latestLedger = mutation(latestLedger);
        return "applied" as const;
      },
    );
    render(
      <MarketDataControls
        applyLedgerMutation={applyLedgerMutation}
        client={client}
        clock={clock}
        isWritable
        ledgerData={latestLedger}
        ledgerEpoch={1}
        mode="auto"
        onModeChange={onModeChange}
      />,
    );
    await waitFor(() => {
      expect(screen.getByText("当前没有需要刷新的非零持仓映射。")).toBeTruthy();
    });

    fireEvent.click(screen.getByRole("button", { name: "手动价格" }));
    expect(onModeChange).toHaveBeenCalledWith("manual");

    const input = screen.getByLabelText("BTC");
    fireEvent.change(input, { target: { value: " btcusdt " } });
    fireEvent.click(
      screen.getAllByRole("button", { name: "验证并保存" })[0],
    );
    await waitFor(() => {
      expect(
        screen.getByText("交易对已验证并加入保存队列。"),
      ).toBeTruthy();
    });
    expect(client.validateSpotSymbol).toHaveBeenLastCalledWith(
      "BTC",
      "BTCUSDT",
      expect.any(AbortSignal),
    );
    expect(latestLedger.assets[0].binanceMapping?.symbol).toBe("BTCUSDT");
    expect(screen.getByText(/不会发送交易、数量、成本、密码或完整账本/)).toBeTruthy();
  });
});
