// @vitest-environment jsdom

import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";

import { createInitialLedgerData } from "@/core/state";
import type { LedgerPnlSummary } from "@/features/portfolio";
import type {
  HoldingAllocation,
  HoldingHistoryPoint,
  TradeHeatmapDay,
} from "@/features/charts";
import { createUsdtSimpleTrade } from "@/test-support";
import { HomeWorkspace } from "./HomeWorkspace";

afterEach(cleanup);

vi.mock("@/features/charts/ui", () => ({
  HoldingAllocationChart: () => <div>allocation-chart</div>,
  HoldingTrendChart: () => <div>trend-chart</div>,
  TradeHeatmapChart: ({
    onSelectedTradeDateChange,
    onViewAll,
    variant,
  }: {
    onSelectedTradeDateChange: (date: string) => void;
    onViewAll: () => void;
    variant: string;
  }) => (
    <div data-testid="heatmap-chart" data-variant={variant}>
      <button
        onClick={() => onSelectedTradeDateChange("2026-08-10")}
        type="button"
      >
        heatmap-chart
      </button>
      <button onClick={onViewAll} type="button">
        view-all-trades
      </button>
    </div>
  ),
}));

const zeroMetric = { value: "0", missingReasons: [] };
const summary: LedgerPnlSummary = {
  buyOutflow: zeroMetric,
  sellProceeds: zeroMetric,
  remainingCostBasis: { value: "10", missingReasons: [] },
  realizedPnl: { value: "2", missingReasons: [] },
  unrealizedPnl: { value: "3", missingReasons: [] },
  feeAccountingIssues: [],
  missingPriceAssets: [],
  excludedCurrencyAssets: [],
  valuation: { label: "USDT", usesApproximation: false },
};
const allocation: HoldingAllocation = {
  slices: [
    {
      assetSymbol: "BTC",
      marketValue: "15",
      ratio: "1",
      source: "manual",
      asOf: "2026-08-13",
    },
  ],
  totalMarketValue: "15",
  missingPriceAssets: [],
  excludedCurrencyAssets: [],
  valuation: { label: "USDT", usesApproximation: false },
};
const history: HoldingHistoryPoint[] = [];
const heatmap: TradeHeatmapDay[] = [];
const position = {
  assetSymbol: "BTC",
  quantity: "0.25",
  averageCost: "40",
  costBasis: "10",
  latestPrice: "60",
  marketValue: "15",
  realizedPnl: "2",
  unrealizedPnl: "5",
  currency: "USDT",
};

function renderHome(overrides: Partial<Parameters<typeof HomeWorkspace>[0]> = {}) {
  const ledgerData = {
    ...createInitialLedgerData(),
    trades: [
      createUsdtSimpleTrade("older", "buy", "BTC", "1", "2026-08-01"),
      createUsdtSimpleTrade("latest", "buy", "BTC", "2", "2026-08-12"),
    ],
  };
  const props: Parameters<typeof HomeWorkspace>[0] = {
    active: true,
    ledgerData,
    positions: [position],
    pnlSummary: summary,
    allocation,
    history,
    heatmap,
    range: "30d",
    valuationPriceMode: "auto",
    onRangeChange: vi.fn(),
    onValuationPriceModeChange: vi.fn(),
    onNavigateToTrade: vi.fn(),
    onNavigateToPrice: vi.fn(),
    onNavigateToTransactions: vi.fn(),
    ...overrides,
  };
  return { props, view: render(<HomeWorkspace {...props} />) };
}

describe("HomeWorkspace", () => {
  it("shows four factual metrics and removes the duplicate recent-trade card", () => {
    renderHome();
    for (const label of [
      "当前总市值",
      "剩余持仓成本",
      "未实现盈亏",
      "已实现盈亏",
    ]) {
      expect(screen.getByRole("heading", { name: label })).toBeTruthy();
    }
    expect(screen.getByRole("button", { name: /记一笔交易/ })).toBeTruthy();
    expect(screen.queryByRole("heading", { name: "最近交易" })).toBeNull();
    expect(screen.queryByText(/2026-08-12/)).toBeNull();
    expect(screen.getByTestId("heatmap-chart").dataset.variant).toBe("home");
  });

  it("stacks cards at phone width and uses the 1100px workspace breakpoint", () => {
    renderHome();
    const workspace = screen.getByRole("region", { name: "首页工作区" });
    const summaryGrid = workspace.querySelector("div.grid.grid-cols-1");
    expect(summaryGrid?.className).toContain("sm:grid-cols-2");
    expect(summaryGrid?.className).toContain("min-[1100px]:grid-cols-4");
    expect(workspace.innerHTML).toContain(
      "min-[1100px]:grid-cols-[minmax(0,1fr)_minmax(0,2fr)]",
    );
    expect(
      screen.getByRole("button", { name: /记一笔交易/ }).innerHTML,
    ).toContain("motion-reduce:transform-none");
  });

  it("routes heatmap days and view-all through explicit intents", async () => {
    const onNavigateToTransactions = vi.fn();
    const { props } = renderHome({ onNavigateToTransactions });
    const user = userEvent.setup();

    await user.click(screen.getByRole("button", { name: "heatmap-chart" }));
    expect(onNavigateToTransactions).toHaveBeenCalledWith({
      filterDate: "2026-08-10",
    });
    await user.click(screen.getByRole("button", { name: "view-all-trades" }));
    expect(onNavigateToTransactions).toHaveBeenCalledWith({
      clearFilters: true,
    });
    expect(props.ledgerData.trades.map((trade) => trade.id)).toEqual([
      "older",
      "latest",
    ]);
  });

  it("keeps an empty ledger truthful and offers the first-record action", async () => {
    const onNavigateToTrade = vi.fn();
    renderHome({
      ledgerData: createInitialLedgerData(),
      positions: [],
      allocation: {
        ...allocation,
        slices: [],
        totalMarketValue: undefined,
      },
      onNavigateToTrade,
    });
    const user = userEvent.setup();

    expect(screen.getByText("还没有交易记录")).toBeTruthy();
    expect(screen.getByText("0 USDT")).toBeTruthy();
    await user.click(screen.getByRole("button", { name: "记录第一笔交易" }));
    expect(onNavigateToTrade).toHaveBeenCalledOnce();
  });

  it("closes holding details on page leave and restores focus after Escape", async () => {
    const { props, view } = renderHome();
    const user = userEvent.setup();
    const trigger = screen.getByRole("button", { name: "查看全部持仓" });

    await user.click(trigger);
    expect(
      screen.getByRole("complementary", { name: "完整持仓详情" }),
    ).toBeTruthy();
    await user.keyboard("{Escape}");
    await waitFor(() => expect(document.activeElement).toBe(trigger));

    await user.click(trigger);
    view.rerender(<HomeWorkspace {...props} active={false} />);
    expect(
      screen.queryByRole("complementary", { name: "完整持仓详情" }),
    ).toBeNull();
  });

});
