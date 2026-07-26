import { describe, expect, it } from "vitest";

import type {
  HoldingAllocationSlice,
  HoldingHistoryPoint,
  TradeHeatmapDay,
} from "../../services/chartDataService";
import {
  buildAllocationChartOption,
  buildHoldingHistoryChartOption,
  buildTradeHeatmapChartOption,
  toFiniteChartNumber,
} from "./chartOptionBuilders";

describe("chart option builders", () => {
  it("converts Decimal strings only at the pie render boundary and preserves provenance", () => {
    const slices: HoldingAllocationSlice[] = [
      {
        assetSymbol: "BTC",
        marketValue: "12.34567890123456789",
        ratio: "1",
        source: "binance",
        asOf: "2026-07-25T08:00:00Z",
      },
    ];

    const option = buildAllocationChartOption(slices);
    const series = option.series as Array<Record<string, unknown>>;
    const data = series[0].data as Array<Record<string, unknown>>;
    const tooltip = option.tooltip as {
      formatter: (params: unknown) => string;
    };

    expect(series[0].type).toBe("pie");
    expect(data[0]).toMatchObject({
      name: "BTC",
      value: 12.345678901234567,
      marketValue: "12.34567890123456789",
      ratio: "1",
      source: "binance",
      asOf: "2026-07-25T08:00:00Z",
    });
    expect(tooltip.formatter({ data: data[0] })).toContain(
      "Binance · as-of 2026-07-25T08:00:00Z",
    );
  });

  it("uses two step lines and leaves missing market values disconnected", () => {
    const points: HoldingHistoryPoint[] = [
      {
        date: "2026-07-24",
        totalCostBasis: "10",
        totalMarketValue: "12",
        missingPriceAssets: [],
        excludedCurrencyAssets: [],
        priceAsOfByAsset: { BTC: "2026-07-24" },
      },
      {
        date: "2026-07-25",
        totalCostBasis: "15",
        missingPriceAssets: ["ETH"],
        excludedCurrencyAssets: [],
        priceAsOfByAsset: {},
      },
    ];

    const option = buildHoldingHistoryChartOption(points);
    const series = option.series as Array<Record<string, unknown>>;

    expect(series).toHaveLength(2);
    expect(series[0]).toMatchObject({
      name: "持仓总市值",
      type: "line",
      step: "end",
      smooth: false,
      connectNulls: false,
      data: [12, "-"],
    });
    expect(series[1]).toMatchObject({
      name: "持仓成本",
      type: "line",
      step: "end",
      smooth: false,
      connectNulls: false,
      data: [10, 15],
    });
  });

  it("renders all 365 heatmap days with five textual levels", () => {
    const days: TradeHeatmapDay[] = Array.from(
      { length: 365 },
      (_, index) => ({
        date: `day-${index}`,
        total: index === 364 ? 2 : 0,
        buys: index === 364 ? 1 : 0,
        sells: index === 364 ? 1 : 0,
        level: index === 364 ? 4 : 0,
      }),
    );

    const option = buildTradeHeatmapChartOption(days);
    const series = option.series as Array<Record<string, unknown>>;
    const data = series[0].data as unknown[];
    const visualMap = option.visualMap as {
      pieces: Array<Record<string, unknown>>;
    };
    const calendar = option.calendar as Record<string, unknown>;

    expect(series[0]).toMatchObject({
      type: "heatmap",
      coordinateSystem: "calendar",
    });
    expect(data).toHaveLength(365);
    expect(data.at(-1)).toEqual(["day-364", 4, 2, 1, 1]);
    expect(visualMap.pieces.map((piece) => piece.label)).toEqual([
      "无交易",
      "低",
      "较低",
      "较高",
      "最高",
    ]);
    expect(calendar.range).toEqual(["day-0", "day-364"]);
  });

  it("rejects non-finite render values", () => {
    expect(() => toFiniteChartNumber("1e10000")).toThrow(
      "Chart values must convert to a finite number",
    );
  });
});
