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
  { value: "1d", label: "1 day" },
  { value: "7d", label: "7 days" },
  { value: "30d", label: "30 days" },
  { value: "365d", label: "365 days" },
  { value: "all", label: "All" },
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
          Current USD-equivalent position allocation
        </h3>
        {allocation.slices.length > 0 ? (
          <>
            <EChart
              ariaLabel="Current USD-equivalent position allocation pie chart"
              className="h-80 w-full"
              option={allocationOption}
            />
            <p className="text-sm leading-6 text-slate-600">
              {allocation.slices.length} valued assets; total market value{" "}
              {allocation.totalMarketValue} USD equivalent.
            </p>
          </>
        ) : allocation.missingPriceAssets.length > 0 ? (
          <p className="mt-3 text-sm leading-6 text-amber-800">
            Non-zero positions lack valid prices, so no misleading empty pie is drawn. Missing prices:
            {allocation.missingPriceAssets.join(", ")}.
          </p>
        ) : (
          <p className="mt-3 text-sm leading-6 text-slate-600">
            There are no displayable non-zero USD/USDT positions.
          </p>
        )}
        {allocation.slices.length > 0 &&
        allocation.missingPriceAssets.length > 0 ? (
          <p className="mt-2 text-sm font-medium text-amber-800">
            Unvalued assets: {allocation.missingPriceAssets.join(", ")}.
          </p>
        ) : null}
        {allocation.excludedCurrencyAssets.length > 0 ? (
          <p className="mt-2 text-sm font-medium text-amber-800">
            Legacy non-USD/USDT assets excluded:
            {allocation.excludedCurrencyAssets.join(", ")}.
          </p>
        ) : null}
      </article>

      <article className="min-w-0 overflow-hidden rounded-md border border-slate-200 bg-slate-50 p-4">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <h3 className="font-semibold text-slate-950">
              Position market value / position cost basis
            </h3>
            <p className="mt-1 text-xs leading-5 text-slate-500">
              Daily step line; excludes cash, is not account net worth, and currently excludes fees from cost.
            </p>
          </div>
          <div
            aria-label="Position history range"
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
          ariaLabel="Position market value and cost basis step-line chart"
          className="mt-3 h-80 w-full"
          option={historyOption}
        />
        <p className="text-sm leading-6 text-slate-600">
          {history.length} display points; {valuedHistoryDays} have complete market prices
          {missingHistoryDays > 0
            ? `; ${missingHistoryDays} market-value points are disconnected by missing prices`
            : ""}
          .
        </p>
        {range === "1d" ? (
          <p className="mt-1 text-sm font-medium text-amber-800">
            No reliable intraday change; boundary points are display-only.
          </p>
        ) : null}
      </article>

      <article className="min-w-0 overflow-hidden rounded-md border border-slate-200 bg-slate-50 p-4">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <h3 className="font-semibold text-slate-950">
              Trading activity over the last 365 days
            </h3>
            <p className="mt-1 text-xs leading-5 text-slate-500">
              One column per week and one row per weekday; {heatmap.length} calendar days and {totalTrades}{" "}
              trades.
            </p>
          </div>
          {selectedTradeDate ? (
            <button
              className="rounded-md border border-slate-300 bg-white px-3 py-1.5 text-sm font-medium text-slate-700"
              onClick={() => onSelectedTradeDateChange(null)}
              type="button"
            >
              Clear date filter
            </button>
          ) : null}
        </div>
        <EChart
          ariaLabel="Trading activity heatmap for the last 365 days"
          className="mt-3 h-56 w-full"
          events={heatmapEvents}
          option={heatmapOption}
        />
        <p className="text-sm leading-6 text-slate-600">
          Activity levels: no trades / low / medium-low / medium-high / highest.
          {selectedTradeDate
            ? ` Trades on ${selectedTradeDate} are filtered; click the same day again to clear.`
            : " Click a date cell to filter the trade list."}
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
