// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import type {
  HoldingAllocation,
  HoldingHistoryPoint,
  TradeHeatmapDay,
} from "../../services/chartDataService";

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
  totalMarketValue: "100",
  missingPriceAssets: ["ETH"],
  excludedCurrencyAssets: [],
};
const history: HoldingHistoryPoint[] = [
  {
    date: "2026-07-25",
    totalCostBasis: "80",
    totalMarketValue: "100",
    missingPriceAssets: [],
    excludedCurrencyAssets: [],
    priceAsOfByAsset: { BTC: "2026-07-25" },
  },
];
const heatmap: TradeHeatmapDay[] = [
  {
    date: "2026-07-25",
    total: 3,
    buys: 2,
    sells: 1,
    level: 4,
  },
];

afterEach(() => {
  cleanup();
});

describe("ChartsOverview", () => {
  it("renders three charts, truthful summaries and all functional ranges", () => {
    const onRangeChange = vi.fn();

    render(
      <ChartsOverview
        allocation={allocation}
        heatmap={heatmap}
        history={history}
        onRangeChange={onRangeChange}
        onSelectedTradeDateChange={vi.fn()}
        range="30d"
        selectedTradeDate={null}
      />,
    );

    expect(
      screen.getByRole("button", {
        name: "当前 USD 等值持仓分配饼图",
      }),
    ).not.toBeNull();
    expect(
      screen.getByRole("button", {
        name: "持仓总市值与持仓成本阶梯线图",
      }),
    ).not.toBeNull();
    expect(
      screen.getByRole("button", {
        name: "最近 365 天交易活跃热力图",
      }),
    ).not.toBeNull();
    expect(screen.getByText("未估值资产：ETH。")).not.toBeNull();
    expect(
      screen.getByText(/活跃等级：无交易 \/ 低 \/ 较低 \/ 较高 \/ 最高/),
    ).not.toBeNull();

    fireEvent.click(screen.getByRole("button", { name: "1日" }));
    expect(onRangeChange).toHaveBeenCalledWith("1d");
    for (const label of ["1日", "7日", "30日", "365日", "全部"]) {
      expect(screen.getByRole("button", { name: label })).not.toBeNull();
    }
  });

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
