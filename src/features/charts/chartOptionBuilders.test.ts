import { describe, expect, it } from "vitest";

import type {
  HoldingAllocationSlice,
  HoldingHistoryPoint,
  TradeHeatmapDay,
} from "./chartDataService";
import {
  ALLOCATION_CHART_COLORS,
  buildAllocationChartOption,
  buildHoldingHistoryChartOption,
  buildTradeHeatmapChartOption,
  GROUPED_ALLOCATION_COLOR,
  TRADE_HEATMAP_LEVEL_COLORS,
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

    const option = buildAllocationChartOption(slices, "USDT");
    const series = option.series as Array<Record<string, unknown>>;
    const data = series[0].data as Array<Record<string, unknown>>;
    const tooltip = option.tooltip as {
      appendTo: string;
      formatter: (params: unknown) => string;
    };

    expect(series[0].type).toBe("pie");
    expect(tooltip.appendTo).toBe("body");
    expect(tooltip).not.toHaveProperty("confine");
    expect(data[0]).toMatchObject({
      name: "BTC",
      value: 12.345678901234567,
      marketValue: "12.34567890123456789",
      ratio: "1",
      source: "binance",
      asOf: "2026-07-25T08:00:00Z",
    });
    expect(data[0]).not.toHaveProperty("itemStyle");
    expect(data[0]).not.toHaveProperty("groupedMembers");
    expect(tooltip.formatter({ data: data[0] })).toContain(
      "Binance · 截至 2026-07-25T08:00:00Z",
    );
    expect(tooltip.formatter({ data: data[0] })).toContain("12.35 USDT");
    expect(tooltip.formatter({ data: data[0] })).toContain("+100.00%");
    expect(tooltip.formatter({ data: data[0] })).not.toContain(
      "12.34567890123456789 USDT",
    );
  });

  it("uses a ten-colour palette and renders every grouped member in the neutral other tooltip", () => {
    const slices: HoldingAllocationSlice[] = [
      {
        assetSymbol: "其他",
        marketValue: "1.23486",
        ratio: "0.0123486",
        source: "grouped",
        asOf: "2026-07-25",
        groupedMembers: [
          { assetSymbol: "ALPHA", marketValue: "1.23456" },
          { assetSymbol: "BETA", marketValue: "0.0003" },
        ],
      },
    ];

    const option = buildAllocationChartOption(slices, "USDT");
    const series = option.series as Array<Record<string, unknown>>;
    const data = series[0].data as Array<Record<string, unknown>>;
    const tooltip = option.tooltip as {
      formatter: (params: unknown) => string;
    };
    const palette = option.color as string[];
    const content = tooltip.formatter({ data: data[0] });

    expect(ALLOCATION_CHART_COLORS).toHaveLength(10);
    expect(new Set(palette).size).toBeGreaterThanOrEqual(10);
    expect(data[0]).toMatchObject({
      name: "其他",
      source: "grouped",
      itemStyle: { color: GROUPED_ALLOCATION_COLOR },
      groupedMembers: slices[0].groupedMembers,
    });
    expect(content).toContain("ALPHA：1.23 USDT");
    expect(content).toContain("BETA：0.0003 USDT");
    expect(content).toContain("小额资产合并 · 截至 2026-07-25");
  });

  it("uses two step lines and leaves missing market values disconnected", () => {
    const points: HoldingHistoryPoint[] = [
      {
        date: "2026-07-24",
        totalCostBasis: "10",
        totalMarketValue: "12",
        assetMarketValue: "12",
        cashBalance: "0",
        cashDeficit: "0",
        missingPriceAssets: [],
        excludedCurrencyAssets: [],
        unreliableFeeAssets: [],
        priceAsOfByAsset: { BTC: "2026-07-24" },
        valuation: { label: "USDT", usesApproximation: false },
      },
      {
        date: "2026-07-25",
        totalCostBasis: "15",
        assetMarketValue: "0",
        cashBalance: "0",
        cashDeficit: "0",
        missingPriceAssets: ["ETH"],
        excludedCurrencyAssets: [],
        unreliableFeeAssets: [],
        priceAsOfByAsset: {},
        valuation: { label: "USDT", usesApproximation: false },
      },
    ];

    const option = buildHoldingHistoryChartOption(points);
    const series = option.series as Array<Record<string, unknown>>;
    const tooltip = option.tooltip as {
      appendTo: string;
      formatter: (params: unknown) => string;
    };

    expect(series).toHaveLength(2);
    expect(tooltip.appendTo).toBe("body");
    expect(tooltip).not.toHaveProperty("confine");
    expect(series[0]).toMatchObject({
      name: "总资产",
      type: "line",
      step: "end",
      smooth: false,
      connectNulls: false,
      showSymbol: false,
      lineStyle: { color: "#d9822b", width: 2.5 },
      data: [12, "-"],
    });
    expect(series[1]).toMatchObject({
      name: "剩余持仓成本",
      type: "line",
      step: "end",
      smooth: false,
      connectNulls: false,
      showSymbol: false,
      lineStyle: { color: "#8b8176", type: "dashed", width: 2 },
      data: [10, 15],
    });
    expect((option.yAxis as Record<string, unknown>).name).toBe("USDT");
    expect(tooltip.formatter({ axisValue: "2026-07-24" })).toContain(
      "剩余持仓成本：10.00 USDT",
    );
    expect(tooltip.formatter({ axisValue: "2026-07-24" })).toContain(
      "总资产：12.00 USDT",
    );
    expect(tooltip.formatter({ axisValue: "2026-07-24" })).toContain(
      "USDT 现金：0.00 USDT",
    );
  });

  it("breaks fee-sensitive cost while keeping market value visible", () => {
    const points: HoldingHistoryPoint[] = [
      {
        date: "2026-07-25",
        totalMarketValue: "100",
        assetMarketValue: "100",
        cashBalance: "0",
        cashDeficit: "0",
        missingPriceAssets: [],
        excludedCurrencyAssets: [],
        unreliableFeeAssets: ["BTC"],
        priceAsOfByAsset: { BTC: "2026-07-25" },
        valuation: { label: "USDT", usesApproximation: false },
      },
    ];

    const option = buildHoldingHistoryChartOption(points);
    const series = option.series as Array<Record<string, unknown>>;
    const tooltip = option.tooltip as {
      formatter: (params: unknown) => string;
    };

    expect(series[0].data).toEqual([100]);
    expect(series[1].data).toEqual(["-"]);
    expect(tooltip.formatter({ axisValue: "2026-07-25" })).toContain(
      "手续费币种问题：BTC",
    );
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
        activityGroups:
          index === 364
            ? [
                { assetSymbol: "BTC", type: "buy", count: 1 },
                { assetSymbol: "BTC", type: "sell", count: 1 },
              ]
            : [],
      }),
    );

    const option = buildTradeHeatmapChartOption(days);
    const series = option.series as Array<Record<string, unknown>>;
    const data = series[0].data as unknown[];
    const visualMap = option.visualMap as {
      pieces: Array<Record<string, unknown>>;
    };
    const calendar = option.calendar as Record<string, unknown>;
    const tooltip = option.tooltip as Record<string, unknown>;

    expect(series[0]).toMatchObject({
      type: "heatmap",
      coordinateSystem: "calendar",
    });
    expect(tooltip.appendTo).toBe("body");
    expect(tooltip).not.toHaveProperty("confine");
    expect(data).toHaveLength(365);
    expect(data.at(-1)).toEqual(["day-364", 4, 2, 1, 1]);
    expect(visualMap.pieces.map((piece) => piece.label)).toEqual([
      "无交易",
      "低",
      "较低",
      "较高",
      "最高",
    ]);
    expect(visualMap.pieces.map((piece) => piece.color)).toEqual(
      TRADE_HEATMAP_LEVEL_COLORS,
    );
    expect(calendar.range).toEqual(["day-0", "day-364"]);
  });

  it("rejects non-finite render values", () => {
    expect(() => toFiniteChartNumber("1e10000")).toThrow(
      "Chart values must convert to a finite number",
    );
  });
});
