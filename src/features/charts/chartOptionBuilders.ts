/**
 * 这个文件管一件事：把图的数据变成 ECharts 能画的设置。
 * 数据在 `chartDataService*.ts` 算好，画布在 `EChart.tsx`。
 * 不显然的决定：金额只在画图时才变成普通数字。
 * 变出来的数不拿回去算钱；2026-08-09 定（W12 01A 第 5.3 节）。
 */
import type { EChartsCoreOption } from "echarts/core";

import {
  DEFAULT_LEDGER_LANGUAGE,
  formatMoney,
  formatPercent,
  translate,
  type Translate,
} from "@/ui";
import type {
  HoldingAllocationSlice,
  HoldingHistoryPoint,
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


const defaultTranslate: Translate = (key) =>
  translate(DEFAULT_LEDGER_LANGUAGE, key);

/**
 * 热力图 0～4 级的五种颜色，从浅到深。
 * 颜色是界面样式，没有特别的理由。
 */
export const TRADE_HEATMAP_LEVEL_COLORS = [
  "#eee9e2",
  "#f6d9b5",
  "#eab36f",
  "#d9822b",
  "#9c4f1a",
] as const;

/** 分配图各块轮流用的十种颜色。 */
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

/** 分配图「其他」那一块的颜色，灰褐色。 */
export const GROUPED_ALLOCATION_COLOR = "#8b8176";

/**
 * 这个函数把一个金额文字变成普通数字，只给画图用。
 * 举例：「4200.5」→ 答 4200.5。
 * 什么时候出错：变不成有限的数（比如「abc」）就抛错。
 */
export function toFiniteChartNumber(value: string): number {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) {
    throw new RangeError("Chart values must convert to a finite number");
  }
  return parsed;
}

/**
 * 这个函数回答：分配图在 ECharts 里怎么设置？
 * 画成一个圆环。
 * 每块的提示里有市值、占比、价格来源和日期。
 * 「其他」那块的提示里列出并进去的每种币。
 */
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

/**
 * 这个函数回答：走势图在 ECharts 里怎么设置？
 * 画两条台阶线：总资产和剩余成本。
 * 缺的点留空，不连起来。
 */
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
