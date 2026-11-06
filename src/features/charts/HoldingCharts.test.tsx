// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import type {
  HoldingAllocation,
  HoldingHistoryPoint,
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

import { HoldingAllocationChart } from "./HoldingAllocationChart";
import { HoldingTrendChart } from "./HoldingTrendChart";

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
afterEach(() => {
  cleanup();
});

describe("HoldingAllocationChart and HoldingTrendChart", () => {
  it("renders three charts, truthful summaries and all functional ranges", () => {
    const onRangeChange = vi.fn();

    render(
      <>
        <HoldingAllocationChart allocation={allocation} />
        <HoldingTrendChart
          history={history}
          onRangeChange={onRangeChange}
          range="30d"
        />
      </>,
    );

    expect(
      screen.getByRole("button", {
        name: "当前 USDT 资产分配饼图",
      }),
    ).not.toBeNull();
    expect(
      screen.getByRole("button", {
        name: "总资产与剩余持仓成本阶梯线图",
      }),
    ).not.toBeNull();
    expect(screen.getByText("未估值资产：ETH。")).not.toBeNull();

    fireEvent.click(screen.getByRole("button", { name: "1日" }));
    expect(onRangeChange).toHaveBeenCalledWith("1d");
    for (const label of ["1日", "7日", "30日", "365日", "全部"]) {
      expect(screen.getByRole("button", { name: label })).not.toBeNull();
    }
  });

  it("labels a negative cash deficit without drawing a cash slice", () => {
    render(
      <HoldingAllocationChart
        allocation={{
          ...allocation,
          cashBalance: "-25",
          cashDeficit: "25",
          totalMarketValue: "75",
        }}
      />,
    );

    expect(screen.getByTitle("25").closest("p")?.textContent).toBe(
      "现金缺口 25.00 USDT；负现金不绘制为正扇区。",
    );
    expect(allocation.slices.map((slice) => slice.assetSymbol)).not.toContain(
      "现金 USDT",
    );
  });

  it("marks the one-day range as having no reliable intraday change", () => {
    render(
      <HoldingTrendChart
        history={history}
        onRangeChange={vi.fn()}
        range="1d"
      />,
    );

    expect(
      screen.getByText("无可靠日内变化，边界点仅用于显示。"),
    ).not.toBeNull();
  });
});
