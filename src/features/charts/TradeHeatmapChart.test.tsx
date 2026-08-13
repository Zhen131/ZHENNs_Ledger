// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { addLedgerDays } from "@/core/shared";
import type { TradeHeatmapDay } from "./chartDataService";
import { TradeHeatmapChart } from "./TradeHeatmapChart";

afterEach(cleanup);

function createHeatmap(todayKey: string): TradeHeatmapDay[] {
  return Array.from({ length: 365 }, (_, index) => ({
    date: addLedgerDays(todayKey, index - 364),
    total: 0,
    buys: 0,
    sells: 0,
    level: 0 as const,
    activityGroups: [],
  }));
}

function addActivity(
  days: TradeHeatmapDay[],
  date: string,
): TradeHeatmapDay[] {
  return days.map((day) =>
    day.date === date
      ? {
          ...day,
          total: 7,
          buys: 4,
          sells: 3,
          level: 4,
          activityGroups: [
            { assetSymbol: "BTC", type: "buy", count: 2 },
            { assetSymbol: "BTC", type: "sell", count: 2 },
            { assetSymbol: "ETH", type: "buy", count: 2 },
            { assetSymbol: "ADA", type: "sell", count: 1 },
          ],
        }
      : day,
  );
}

describe("home TradeHeatmapChart", () => {
  it.each([
    ["2026-08-10", "1"],
    ["2026-08-13", "4"],
    ["2026-08-16", "7"],
  ])(
    "keeps all 365 dates and places %s in the final natural week row",
    (todayKey, expectedRow) => {
      render(
        <TradeHeatmapChart
          heatmap={createHeatmap(todayKey)}
          onLocateDate={vi.fn()}
          onViewAll={vi.fn()}
          variant="home"
        />,
      );

      const cells = screen.getAllByRole("gridcell");
      const today = screen.getByRole("gridcell", {
        name: `${todayKey}，当天无交易`,
      });
      expect(cells).toHaveLength(365);
      expect(today.style.gridColumn).toBe("53");
      expect(today.style.gridRow).toBe(expectedRow);
      expect(screen.getByRole("grid").className).toContain("max-w-[636px]");
      expect(screen.queryByText("一月")).toBeNull();
      expect(screen.queryByText("最高")).toBeNull();
    },
  );

  it("shows grouped activity on hover, shows empty days only on click, and preserves both navigation actions", () => {
    const activityDate = "2026-08-13";
    const emptyDate = "2026-08-12";
    const onLocateDate = vi.fn();
    const onViewAll = vi.fn();
    render(
      <TradeHeatmapChart
        heatmap={addActivity(createHeatmap(activityDate), activityDate)}
        onLocateDate={onLocateDate}
        onViewAll={onViewAll}
        variant="home"
      />,
    );

    const activityCell = screen.getByRole("gridcell", {
      name: `${activityDate}，共 7 笔，买入 4 笔，卖出 3 笔`,
    });
    const emptyCell = screen.getByRole("gridcell", {
      name: `${emptyDate}，当天无交易`,
    });

    fireEvent.mouseEnter(activityCell);
    expect(screen.getByRole("tooltip").textContent).toContain(activityDate);
    expect(screen.getByRole("tooltip").textContent).toContain(
      "共 7 笔 · 买入 4 笔 · 卖出 3 笔",
    );
    expect(screen.getByRole("tooltip").textContent).toContain("BTC 买入 ×2");
    expect(screen.getByRole("tooltip").textContent).toContain("BTC 卖出 ×2");
    expect(screen.getByRole("tooltip").textContent).toContain("ETH 买入 ×2");
    expect(screen.getByRole("tooltip").textContent).toContain("另有 1 笔交易");
    expect(screen.getByRole("tooltip").textContent).not.toContain("USDT");

    fireEvent.mouseLeave(activityCell);
    fireEvent.mouseEnter(emptyCell);
    expect(screen.queryByRole("tooltip")).toBeNull();
    fireEvent.click(emptyCell);
    expect(screen.getByRole("tooltip").textContent).toContain(emptyDate);
    expect(screen.getByRole("tooltip").textContent).toContain("当天无交易");
    expect(onLocateDate).not.toHaveBeenCalled();

    fireEvent.pointerDown(screen.getByRole("heading", {
      name: "最近 365 天交易活动",
    }));
    expect(screen.queryByRole("tooltip")).toBeNull();

    fireEvent.click(activityCell);
    expect(onLocateDate).toHaveBeenCalledWith(activityDate);
    expect(screen.queryByRole("tooltip")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "查看全部交易" }));
    expect(onViewAll).toHaveBeenCalledOnce();
  });
});
