import type { EChartsCoreOption } from "echarts/core";

import type {
  HoldingAllocationSlice,
  HoldingHistoryPoint,
  TradeHeatmapDay,
} from "../../services/chartDataService";

type PieDatum = {
  name: string;
  value: number;
  marketValue: string;
  ratio: string;
  source: "manual" | "binance";
  asOf: string;
};

type TooltipParams = {
  axisValue?: string;
  data?: unknown;
};

export function toFiniteChartNumber(value: string): number {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) {
    throw new RangeError("Chart values must convert to a finite number");
  }
  return parsed;
}

export function buildAllocationChartOption(
  slices: readonly HoldingAllocationSlice[],
): EChartsCoreOption {
  const data: PieDatum[] = slices.map((slice) => ({
    name: slice.assetSymbol,
    value: toFiniteChartNumber(slice.marketValue),
    marketValue: slice.marketValue,
    ratio: slice.ratio,
    source: slice.source,
    asOf: slice.asOf,
  }));

  return {
    tooltip: {
      trigger: "item",
      formatter: (params: TooltipParams) => {
        const datum = params.data as PieDatum | undefined;
        if (!datum) {
          return "";
        }
        const source = datum.source === "binance" ? "Binance" : "手动价格";
        const ratio = toFiniteChartNumber(datum.ratio) * 100;
        return [
          `<strong>${datum.name}</strong>`,
          `${datum.marketValue} USD 等值`,
          `${ratio.toFixed(2)}%`,
          `${source} · as-of ${datum.asOf}`,
        ].join("<br/>");
      },
    },
    legend: {
      bottom: 0,
      type: "scroll",
    },
    series: [
      {
        name: "当前 USD 等值持仓分配",
        type: "pie",
        radius: ["42%", "70%"],
        center: ["50%", "43%"],
        avoidLabelOverlap: true,
        data,
      },
    ],
  };
}

export function buildHoldingHistoryChartOption(
  points: readonly HoldingHistoryPoint[],
): EChartsCoreOption {
  const pointsByDate = new Map(points.map((point) => [point.date, point]));

  return {
    tooltip: {
      trigger: "axis",
      formatter: (params: TooltipParams | TooltipParams[]) => {
        const first = Array.isArray(params) ? params[0] : params;
        const date = first?.axisValue ?? "";
        const point = pointsByDate.get(date);
        if (!point) {
          return date;
        }
        const marketValue =
          point.totalMarketValue === undefined
            ? `缺价：${point.missingPriceAssets.join("、")}`
            : `${point.totalMarketValue} USD 等值`;
        return [
          `<strong>${date}</strong>`,
          `持仓成本：${point.totalCostBasis} USD 等值`,
          `持仓总市值：${marketValue}`,
        ].join("<br/>");
      },
    },
    legend: {
      data: ["持仓总市值", "持仓成本"],
      top: 0,
    },
    grid: {
      left: 64,
      right: 16,
      top: 48,
      bottom: 28,
    },
    xAxis: {
      type: "category",
      boundaryGap: false,
      data: points.map((point) => point.date),
    },
    yAxis: {
      type: "value",
      name: "USD 等值",
      scale: true,
    },
    series: [
      {
        name: "持仓总市值",
        type: "line",
        step: "end",
        smooth: false,
        connectNulls: false,
        showSymbol: points.length <= 30,
        data: points.map((point) =>
          point.totalMarketValue === undefined
            ? "-"
            : toFiniteChartNumber(point.totalMarketValue),
        ),
      },
      {
        name: "持仓成本",
        type: "line",
        step: "end",
        smooth: false,
        connectNulls: false,
        showSymbol: points.length <= 30,
        data: points.map((point) =>
          toFiniteChartNumber(point.totalCostBasis),
        ),
      },
    ],
  };
}

export function buildTradeHeatmapChartOption(
  days: readonly TradeHeatmapDay[],
): EChartsCoreOption {
  const startDate = days[0]?.date ?? "";
  const endDate = days.at(-1)?.date ?? "";

  return {
    tooltip: {
      formatter: (params: TooltipParams) => {
        const datum = params.data as
          | [string, number, number, number, number]
          | undefined;
        if (!datum) {
          return "";
        }
        return [
          `<strong>${datum[0]}</strong>`,
          `总笔数：${datum[2]}`,
          `买入：${datum[3]}`,
          `卖出：${datum[4]}`,
        ].join("<br/>");
      },
    },
    visualMap: {
      type: "piecewise",
      dimension: 1,
      seriesIndex: 0,
      orient: "horizontal",
      left: "center",
      bottom: 0,
      pieces: [
        { value: 0, label: "无交易", color: "#e2e8f0" },
        { value: 1, label: "低", color: "#bbf7d0" },
        { value: 2, label: "较低", color: "#4ade80" },
        { value: 3, label: "较高", color: "#16a34a" },
        { value: 4, label: "最高", color: "#166534" },
      ],
    },
    calendar: {
      range: [startDate, endDate],
      orient: "horizontal",
      left: 42,
      right: 16,
      top: 36,
      bottom: 72,
      cellSize: ["auto", 16],
      splitLine: {
        show: false,
      },
      itemStyle: {
        borderColor: "#ffffff",
        borderWidth: 2,
      },
      yearLabel: {
        show: false,
      },
      dayLabel: {
        firstDay: 1,
        nameMap: ["日", "一", "二", "三", "四", "五", "六"],
      },
      monthLabel: {
        nameMap: [
          "一月",
          "二月",
          "三月",
          "四月",
          "五月",
          "六月",
          "七月",
          "八月",
          "九月",
          "十月",
          "十一月",
          "十二月",
        ],
      },
    },
    series: [
      {
        name: "交易活跃",
        type: "heatmap",
        coordinateSystem: "calendar",
        data: days.map((day) => [
          day.date,
          day.level,
          day.total,
          day.buys,
          day.sells,
        ]),
      },
    ],
  };
}
