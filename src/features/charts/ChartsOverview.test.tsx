// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import type {
  HoldingAllocation,
  HoldingHistoryPoint,
  TradeHeatmapDay,
} from "./chartDataService";

vi.mock("./EChart", () => ({
  EChart: ({
    ariaLabel,
    events,
  }: {
    ariaLabel: string;
    events?: Record<string, (params: unknown) => void>;
  }) => (
    <button
      aria-label={ariaLabel}
      onClick={() =>
        events?.click?.({
          data: ["2026-07-25", 4, 3, 2, 1],
        })
      }
      type="button"
    />
  ),
}));

import { ChartsOverview } from "./ChartsOverview";

const allocation: HoldingAllocation = {
  slices: [
    {
      assetSymbol: "BTC",
      marketValue: "100",
      ratio: "1",
      source: "manual",
      asOf: "2026-07-25",
    },
  ],
  assetMarketValue: "100",
  cashBalance: "0",
  cashDeficit: "0",
  totalMarketValue: "100",
  missingPriceAssets: ["ETH"],
  excludedCurrencyAssets: [],
  valuation: { label: "USDT", usesApproximation: false },
};
const history: HoldingHistoryPoint[] = [
  {
    date: "2026-07-25",
    totalCostBasis: "80",
    totalMarketValue: "100",
    assetMarketValue: "100",
    cashBalance: "0",
    cashDeficit: "0",
    missingPriceAssets: [],
    excludedCurrencyAssets: [],
    unreliableFeeAssets: [],
    priceAsOfByAsset: { BTC: "2026-07-25" },
    valuation: { label: "USDT", usesApproximation: false },
  },
];
const heatmap: TradeHeatmapDay[] = [
  {
    date: "2026-07-25",
    total: 3,
    buys: 2,
    sells: 1,
    level: 4,
    activityGroups: [
      { assetSymbol: "BTC", type: "buy", count: 2 },
      { assetSymbol: "BTC", type: "sell", count: 1 },
    ],
  },
];

afterEach(() => {
  cleanup();
});

describe("ChartsOverview", () => {
  it("toggles the heatmap date and exposes a clear action", () => {
    const onSelectedTradeDateChange = vi.fn();
    const { rerender } = render(
      <ChartsOverview
        allocation={allocation}
        heatmap={heatmap}
        history={history}
        onRangeChange={vi.fn()}
        onSelectedTradeDateChange={onSelectedTradeDateChange}
        range="30d"
        selectedTradeDate={null}
      />,
    );

    fireEvent.click(
      screen.getByRole("button", {
        name: "最近 365 天交易活跃热力图",
      }),
    );
    expect(onSelectedTradeDateChange).toHaveBeenLastCalledWith(
      "2026-07-25",
    );

    rerender(
      <ChartsOverview
        allocation={allocation}
        heatmap={heatmap}
        history={history}
        onRangeChange={vi.fn()}
        onSelectedTradeDateChange={onSelectedTradeDateChange}
        range="1d"
        selectedTradeDate="2026-07-25"
      />,
    );
    expect(
      screen.getByText("无可靠日内变化，边界点仅用于显示。"),
    ).not.toBeNull();
    fireEvent.click(
      screen.getByRole("button", {
        name: "最近 365 天交易活跃热力图",
      }),
    );
    expect(onSelectedTradeDateChange).toHaveBeenLastCalledWith(null);

    fireEvent.click(
      screen.getByRole("button", { name: "清除日期筛选" }),
    );
    expect(onSelectedTradeDateChange).toHaveBeenLastCalledWith(null);
  });
});
