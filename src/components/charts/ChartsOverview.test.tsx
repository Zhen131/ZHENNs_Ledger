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
        name: "Current USD-equivalent position allocation pie chart",
      }),
    ).not.toBeNull();
    expect(
      screen.getByRole("button", {
        name: "Position market value and cost basis step-line chart",
      }),
    ).not.toBeNull();
    expect(
      screen.getByRole("button", {
        name: "Trading activity heatmap for the last 365 days",
      }),
    ).not.toBeNull();
    expect(screen.getByText("Unvalued assets: ETH.")).not.toBeNull();
    expect(
      screen.getByText(/Activity levels: no trades \/ low \/ medium-low \/ medium-high \/ highest/),
    ).not.toBeNull();

    fireEvent.click(screen.getByRole("button", { name: "1 day" }));
    expect(onRangeChange).toHaveBeenCalledWith("1d");
    for (const label of ["1 day", "7 days", "30 days", "365 days", "All"]) {
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
        name: "Trading activity heatmap for the last 365 days",
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
      screen.getByText("No reliable intraday change; boundary points are display-only."),
    ).not.toBeNull();
    fireEvent.click(
      screen.getByRole("button", {
        name: "Trading activity heatmap for the last 365 days",
      }),
    );
    expect(onSelectedTradeDateChange).toHaveBeenLastCalledWith(null);

    fireEvent.click(
      screen.getByRole("button", { name: "Clear date filter" }),
    );
    expect(onSelectedTradeDateChange).toHaveBeenLastCalledWith(null);
  });
});
