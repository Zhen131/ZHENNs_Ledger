"use client";

import { useMemo } from "react";

import type {
  ChartRange,
  HoldingAllocation,
  HoldingHistoryPoint,
  TradeHeatmapDay,
} from "../../services/chartDataService";
import { EChart } from "./EChart";
import {
  buildAllocationChartOption,
  buildHoldingHistoryChartOption,
  buildTradeHeatmapChartOption,
} from "./chartOptionBuilders";

const RANGE_OPTIONS: ReadonlyArray<{
  value: ChartRange;
  label: string;
}> = [
  { value: "1d", label: "1日" },
  { value: "7d", label: "7日" },
  { value: "30d", label: "30日" },
  { value: "365d", label: "365日" },
  { value: "all", label: "全部" },
];

export function ChartsOverview({
  allocation,
  history,
  heatmap,
  range,
  selectedTradeDate,
  onRangeChange,
  onSelectedTradeDateChange,
}: Readonly<{
  allocation: HoldingAllocation;
  history: readonly HoldingHistoryPoint[];
  heatmap: readonly TradeHeatmapDay[];
  range: ChartRange;
  selectedTradeDate: string | null;
  onRangeChange: (range: ChartRange) => void;
  onSelectedTradeDateChange: (date: string | null) => void;
}>) {
  const allocationOption = useMemo(
    () => buildAllocationChartOption(allocation.slices),
    [allocation.slices],
  );
  const historyOption = useMemo(
    () => buildHoldingHistoryChartOption(history),
    [history],
  );
  const heatmapOption = useMemo(
    () => buildTradeHeatmapChartOption(heatmap),
    [heatmap],
  );
  const heatmapEvents = useMemo(
    () => ({
      click: (params: unknown) => {
        const date = readHeatmapDate(params);
        if (!date) {
          return;
        }
        onSelectedTradeDateChange(
          selectedTradeDate === date ? null : date,
        );
      },
    }),
    [onSelectedTradeDateChange, selectedTradeDate],
  );
  const valuedHistoryDays = history.filter(
    (point) => point.totalMarketValue !== undefined,
  ).length;
  const missingHistoryDays = history.length - valuedHistoryDays;
  const totalTrades = heatmap.reduce(
    (total, day) => total + day.total,
    0,
  );

  return (
    <div className="grid min-w-0 gap-5">
      <article className="min-w-0 overflow-hidden rounded-md border border-slate-200 bg-slate-50 p-4">
        <h3 className="font-semibold text-slate-950">
          当前 USD 等值持仓分配
        </h3>
        {allocation.slices.length > 0 ? (
          <>
            <EChart
              ariaLabel="当前 USD 等值持仓分配饼图"
              className="h-80 w-full"
              option={allocationOption}
            />
            <p className="text-sm leading-6 text-slate-600">
              已估值 {allocation.slices.length} 项，总市值{" "}
              {allocation.totalMarketValue} USD 等值。
            </p>
          </>
        ) : allocation.missingPriceAssets.length > 0 ? (
          <p className="mt-3 text-sm leading-6 text-amber-800">
            非零持仓缺少合法价格，当前不绘制误导性空饼。缺价资产：
            {allocation.missingPriceAssets.join("、")}。
          </p>
        ) : (
          <p className="mt-3 text-sm leading-6 text-slate-600">
            当前没有可显示的非零 USD/USDT 持仓。
          </p>
        )}
        {allocation.slices.length > 0 &&
        allocation.missingPriceAssets.length > 0 ? (
          <p className="mt-2 text-sm font-medium text-amber-800">
            未估值资产：{allocation.missingPriceAssets.join("、")}。
          </p>
        ) : null}
        {allocation.excludedCurrencyAssets.length > 0 ? (
          <p className="mt-2 text-sm font-medium text-amber-800">
            非 USD/USDT 旧资产已排除：
            {allocation.excludedCurrencyAssets.join("、")}。
          </p>
        ) : null}
      </article>

      <article className="min-w-0 overflow-hidden rounded-md border border-slate-200 bg-slate-50 p-4">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <h3 className="font-semibold text-slate-950">
              持仓总市值 / 持仓成本
            </h3>
            <p className="mt-1 text-xs leading-5 text-slate-500">
              日级阶梯线；不含现金，不代表账户净值，成本暂不计手续费。
            </p>
          </div>
          <div
            aria-label="持仓历史范围"
            className="flex flex-wrap gap-1"
            role="group"
          >
            {RANGE_OPTIONS.map((option) => (
              <button
                aria-pressed={range === option.value}
                className={
                  range === option.value
                    ? "rounded-md bg-slate-950 px-3 py-1.5 text-sm font-medium text-white"
                    : "rounded-md border border-slate-300 bg-white px-3 py-1.5 text-sm font-medium text-slate-700"
                }
                key={option.value}
                onClick={() => onRangeChange(option.value)}
                type="button"
              >
                {option.label}
              </button>
            ))}
          </div>
        </div>
        <EChart
          ariaLabel="持仓总市值与持仓成本阶梯线图"
          className="mt-3 h-80 w-full"
          option={historyOption}
        />
        <p className="text-sm leading-6 text-slate-600">
          {history.length} 个显示点；{valuedHistoryDays} 个点具备完整市场价格
          {missingHistoryDays > 0
            ? `，${missingHistoryDays} 个市值点因缺价断开`
            : ""}
          。
        </p>
        {range === "1d" ? (
          <p className="mt-1 text-sm font-medium text-amber-800">
            无可靠日内变化，边界点仅用于显示。
          </p>
        ) : null}
      </article>

      <article className="min-w-0 overflow-hidden rounded-md border border-slate-200 bg-slate-50 p-4">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <h3 className="font-semibold text-slate-950">
              最近 365 天交易活跃
            </h3>
            <p className="mt-1 text-xs leading-5 text-slate-500">
              一周一列、星期为行；共 {heatmap.length} 个自然日、{totalTrades}{" "}
              笔交易。
            </p>
          </div>
          {selectedTradeDate ? (
            <button
              className="rounded-md border border-slate-300 bg-white px-3 py-1.5 text-sm font-medium text-slate-700"
              onClick={() => onSelectedTradeDateChange(null)}
              type="button"
            >
              清除日期筛选
            </button>
          ) : null}
        </div>
        <EChart
          ariaLabel="最近 365 天交易活跃热力图"
          className="mt-3 h-56 w-full"
          events={heatmapEvents}
          option={heatmapOption}
        />
        <p className="text-sm leading-6 text-slate-600">
          活跃等级：无交易 / 低 / 较低 / 较高 / 最高。
          {selectedTradeDate
            ? ` 当前筛选 ${selectedTradeDate} 的交易，再点同一天可取消。`
            : " 点击日期格可筛选交易列表。"}
        </p>
      </article>
    </div>
  );
}

function readHeatmapDate(params: unknown): string | undefined {
  if (
    !params ||
    typeof params !== "object" ||
    !("data" in params) ||
    !Array.isArray(params.data) ||
    typeof params.data[0] !== "string"
  ) {
    return undefined;
  }
  return params.data[0];
}
