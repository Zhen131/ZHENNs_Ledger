import type { EChartsCoreOption } from "echarts/core";

import {
  DEFAULT_LEDGER_LANGUAGE,
  formatMoney,
  formatPercent,
  translate,
  type TranslationKey,
} from "@/ui";
import type {
  HoldingAllocationSlice,
  HoldingHistoryPoint,
  TradeHeatmapDay,
} from "./chartDataService";

type PieDatum = {
  name: string;
  value: number;
  marketValue: string;
  ratio: string;
  source: "manual" | "binance" | "cash" | "grouped";
  asOf: string;
  groupedMembers?: Array<{
    assetSymbol: string;
    marketValue: string;
  }>;
  itemStyle?: { color: string };
};

type TooltipParams = {
  axisValue?: string;
  data?: unknown;
};

type Translate = (key: TranslationKey) => string;

const defaultTranslate: Translate = (key) =>
  translate(DEFAULT_LEDGER_LANGUAGE, key);

export const TRADE_HEATMAP_LEVEL_COLORS = [
  "#eee9e2",
  "#f6d9b5",
  "#eab36f",
  "#d9822b",
  "#9c4f1a",
] as const;

export const ALLOCATION_CHART_COLORS = [
  "#d9822b",
  "#4e79a7",
  "#59a14f",
  "#e15759",
  "#b07aa1",
  "#76b7b2",
  "#edc948",
  "#f28e2b",
  "#9c755f",
  "#6b8e9f",
] as const;

export const GROUPED_ALLOCATION_COLOR = "#8b8176";

export function toFiniteChartNumber(value: string): number {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) {
    throw new RangeError("Chart values must convert to a finite number");
  }
  return parsed;
}

export function buildAllocationChartOption(
  slices: readonly HoldingAllocationSlice[],
  valuationLabel: string,
  t: Translate = defaultTranslate,
): EChartsCoreOption {
  const data: PieDatum[] = slices.map((slice) => ({
    name: slice.assetSymbol,
    value: toFiniteChartNumber(slice.marketValue),
    marketValue: slice.marketValue,
    ratio: slice.ratio,
    source: slice.source,
    asOf: slice.asOf,
    ...(slice.groupedMembers === undefined
      ? {}
      : { groupedMembers: slice.groupedMembers }),
    ...(slice.source === "grouped"
      ? { itemStyle: { color: GROUPED_ALLOCATION_COLOR } }
      : {}),
  }));

  return {
    color: [...ALLOCATION_CHART_COLORS],
    tooltip: {
      appendTo: "body",
      trigger: "item",
      formatter: (params: TooltipParams) => {
        const datum = params.data as PieDatum | undefined;
        if (!datum) {
          return "";
        }
        const source =
          datum.source === "cash"
            ? t("charts.option.allocation.cashReplay")
            : datum.source === "binance"
              ? "Binance"
              : datum.source === "grouped"
                ? t("charts.option.allocation.grouped")
                : t("charts.option.allocation.manual");
        const groupedMembers =
          datum.source === "grouped"
            ? (datum.groupedMembers ?? []).map(
                (member) =>
                  `${member.assetSymbol}${t("charts.option.allocation.memberSeparator")}${formatMoney(member.marketValue)} ${valuationLabel}`,
              )
            : [];
        return [
          `<strong>${datum.name}</strong>`,
          `${formatMoney(datum.marketValue)} ${valuationLabel}`,
          formatPercent(datum.ratio),
          ...groupedMembers,
          `${source} · ${t("charts.option.allocation.asOfPrefix")}${datum.asOf}`,
        ].join("<br/>");
      },
    },
    legend: {
      bottom: 0,
      type: "scroll",
    },
    series: [
      {
        name: `${t("charts.option.allocation.seriesPrefix")}${valuationLabel}${t("charts.option.allocation.seriesSuffix")}`,
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
  t: Translate = defaultTranslate,
): EChartsCoreOption {
  const pointsByDate = new Map(points.map((point) => [point.date, point]));
  const valuationLabel = getHistoryValuationLabel(points, t);

  return {
    tooltip: {
      appendTo: "body",
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
            ? `${t("charts.option.history.missingPricePrefix")}${point.missingPriceAssets.join(t("charts.option.history.listSeparator"))}`
            : `${formatMoney(point.totalMarketValue)} ${point.valuation.label}`;
        return [
          `<strong>${date}</strong>`,
          `${t("charts.option.history.costBasis")}${
            point.totalCostBasis === undefined
              ? `${t("charts.option.history.feeIssuePrefix")}${point.unreliableFeeAssets.join(t("charts.option.history.listSeparator"))}`
              : `${formatMoney(point.totalCostBasis)} ${point.valuation.label}`
          }`,
          `${t("charts.option.history.totalAssets")}${marketValue}`,
          `${t("charts.option.history.cash")}${formatMoney(point.cashBalance)} ${point.valuation.label}`,
        ].join("<br/>");
      },
    },
    legend: {
      data: [
        t("charts.option.history.totalAssetsSeries"),
        t("charts.option.history.costBasisSeries"),
      ],
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
      name: valuationLabel,
      scale: true,
    },
    series: [
      {
        name: t("charts.option.history.totalAssetsSeries"),
        type: "line",
        step: "end",
        smooth: false,
        connectNulls: false,
        showSymbol: false,
        lineStyle: {
          color: "#d9822b",
          width: 2.5,
        },
        itemStyle: {
          color: "#d9822b",
        },
        areaStyle: {
          color: "rgba(217, 130, 43, 0.12)",
        },
        data: points.map((point) =>
          point.totalMarketValue === undefined
            ? "-"
            : toFiniteChartNumber(point.totalMarketValue),
        ),
      },
      {
        name: t("charts.option.history.costBasisSeries"),
        type: "line",
        step: "end",
        smooth: false,
        connectNulls: false,
        showSymbol: false,
        lineStyle: {
          color: "#8b8176",
          type: "dashed",
          width: 2,
        },
        itemStyle: {
          color: "#8b8176",
        },
        data: points.map((point) =>
          point.totalCostBasis === undefined
            ? "-"
            : toFiniteChartNumber(point.totalCostBasis),
        ),
      },
    ],
  };
}

function getHistoryValuationLabel(
  points: readonly HoldingHistoryPoint[],
  t: Translate,
): string {
  const labels = new Set(points.map((point) => point.valuation.label));
  if (labels.size === 1) {
    return points[0]?.valuation.label ?? "USDT";
  }
  return t("charts.option.history.approximation");
}

export function buildTradeHeatmapChartOption(
  days: readonly TradeHeatmapDay[],
  t: Translate = defaultTranslate,
): EChartsCoreOption {
  const startDate = days[0]?.date ?? "";
  const endDate = days.at(-1)?.date ?? "";

  return {
    tooltip: {
      appendTo: "body",
      formatter: (params: TooltipParams) => {
        const datum = params.data as
          | [string, number, number, number, number]
          | undefined;
        if (!datum) {
          return "";
        }
        return [
          `<strong>${datum[0]}</strong>`,
          `${t("charts.option.heatmap.total")}${datum[2]}`,
          `${t("charts.option.heatmap.buy")}${datum[3]}`,
          `${t("charts.option.heatmap.sell")}${datum[4]}`,
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
        { value: 0, label: t("charts.option.heatmap.none"), color: TRADE_HEATMAP_LEVEL_COLORS[0] },
        { value: 1, label: t("charts.option.heatmap.low"), color: TRADE_HEATMAP_LEVEL_COLORS[1] },
        { value: 2, label: t("charts.option.heatmap.lower"), color: TRADE_HEATMAP_LEVEL_COLORS[2] },
        { value: 3, label: t("charts.option.heatmap.higher"), color: TRADE_HEATMAP_LEVEL_COLORS[3] },
        { value: 4, label: t("charts.option.heatmap.highest"), color: TRADE_HEATMAP_LEVEL_COLORS[4] },
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
        nameMap: [
          t("charts.option.heatmap.sunday"),
          t("charts.option.heatmap.monday"),
          t("charts.option.heatmap.tuesday"),
          t("charts.option.heatmap.wednesday"),
          t("charts.option.heatmap.thursday"),
          t("charts.option.heatmap.friday"),
          t("charts.option.heatmap.saturday"),
        ],
      },
      monthLabel: {
        nameMap: [
          t("charts.option.heatmap.january"),
          t("charts.option.heatmap.february"),
          t("charts.option.heatmap.march"),
          t("charts.option.heatmap.april"),
          t("charts.option.heatmap.may"),
          t("charts.option.heatmap.june"),
          t("charts.option.heatmap.july"),
          t("charts.option.heatmap.august"),
          t("charts.option.heatmap.september"),
          t("charts.option.heatmap.october"),
          t("charts.option.heatmap.november"),
          t("charts.option.heatmap.december"),
        ],
      },
    },
    series: [
      {
        name: t("charts.option.heatmap.series"),
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
