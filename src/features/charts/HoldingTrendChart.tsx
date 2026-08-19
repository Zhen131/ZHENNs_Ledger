"use client";

import { useMemo } from "react";

import type { ChartRange, HoldingHistoryPoint } from "./chartDataService";
import { buildHoldingHistoryChartOption } from "./chartOptionBuilders";
import { EChart } from "./EChart";

export const CHART_RANGE_OPTIONS: ReadonlyArray<{
  value: ChartRange;
  label: string;
}> = [
  { value: "1d", label: "1日" },
  { value: "7d", label: "7日" },
  { value: "30d", label: "30日" },
  { value: "365d", label: "365日" },
  { value: "all", label: "全部" },
];

export function HoldingTrendChart({
  history,
  range,
  onRangeChange,
  compact = false,
  showRangeControl = true,
}: Readonly<{
  history: readonly HoldingHistoryPoint[];
  range: ChartRange;
  onRangeChange: (range: ChartRange) => void;
  compact?: boolean;
  showRangeControl?: boolean;
}>) {
  const option = useMemo(
    () => buildHoldingHistoryChartOption(history),
    [history],
  );
  const valuedDays = history.filter(
    (point) => point.totalMarketValue !== undefined,
  ).length;
  const missingDays = history.length - valuedDays;
  const unreliableCostDays = history.filter(
    (point) => point.totalCostBasis === undefined,
  ).length;

  return (
    <article className="min-w-0 overflow-hidden rounded-2xl border border-[var(--ledger-border)] bg-[var(--ledger-surface)] p-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h3 className="font-semibold text-[var(--ledger-ink)]">
            总资产 / 剩余含费成本
          </h3>
          {!compact ? (
            <p className="mt-1 text-xs leading-5 text-[var(--ledger-muted)]">
              日级阶梯线；总资产逐日重放当时的 USDT 现金与可得行情。成本线仍只来自交易。
            </p>
          ) : null}
        </div>
        {showRangeControl ? (
          <div
            aria-label="持仓历史范围"
            className="flex flex-wrap gap-1"
            role="group"
          >
            {CHART_RANGE_OPTIONS.map((optionItem) => (
              <button
                aria-pressed={range === optionItem.value}
                className={
                  range === optionItem.value
                    ? "rounded-lg bg-[var(--ledger-accent-strong)] px-3 py-1.5 text-sm font-medium text-white"
                    : "rounded-lg border border-[var(--ledger-border)] bg-white px-3 py-1.5 text-sm font-medium text-[var(--ledger-muted)]"
                }
                key={optionItem.value}
                onClick={() => onRangeChange(optionItem.value)}
                type="button"
              >
                {optionItem.label}
              </button>
            ))}
          </div>
        ) : null}
      </div>
      <EChart
        ariaLabel="总资产与剩余含费成本阶梯线图"
        className={compact ? "mt-2 h-48 w-full" : "mt-3 h-80 w-full"}
        option={option}
      />
      {!compact ? (
        <p className="text-sm leading-6 text-[var(--ledger-muted)]">
          {history.length} 个显示点；{valuedDays} 个点具备完整市场价格
          {missingDays > 0 ? `，${missingDays} 个市值点因缺价断开` : ""}。
        </p>
      ) : null}
      {unreliableCostDays > 0 ? (
        <p className="mt-1 text-sm font-medium text-amber-800">
          {unreliableCostDays} 个成本点因异币手续费无法换算而断开；市值线和交易热力图仍按各自事实显示。
        </p>
      ) : null}
      {range === "1d" ? (
        <p className="mt-1 text-sm font-medium text-amber-800">
          无可靠日内变化，边界点仅用于显示。
        </p>
      ) : null}
    </article>
  );
}
