"use client";

import { useMemo } from "react";
import { useLanguage } from "@/ui";

import type { ChartRange, HoldingHistoryPoint } from "./chartDataService";
import { buildHoldingHistoryChartOption } from "./chartOptionBuilders";
import { EChart } from "./EChart";

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
  const { t } = useLanguage();
  const chartRangeOptions: ReadonlyArray<{
    value: ChartRange;
    label: string;
  }> = [
    { value: "1d", label: t("charts.trend.range1d") },
    { value: "7d", label: t("charts.trend.range7d") },
    { value: "30d", label: t("charts.trend.range30d") },
    { value: "365d", label: t("charts.trend.range365d") },
    { value: "all", label: t("charts.trend.rangeAll") },
  ];
  const option = useMemo(
    () => buildHoldingHistoryChartOption(history, t),
    [history, t],
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
            {t("charts.trend.heading")}
          </h3>
          {!compact ? (
            <p className="mt-1 text-xs leading-5 text-[var(--ledger-muted)]">
              {t("charts.trend.description")}
            </p>
          ) : null}
        </div>
        {showRangeControl ? (
          <div
            aria-label={t("charts.trend.rangeAriaLabel")}
            className="flex flex-wrap gap-1"
            role="group"
          >
            {chartRangeOptions.map((optionItem) => (
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
        ariaLabel={t("charts.trend.ariaLabel")}
        className={compact ? "mt-2 h-48 w-full" : "mt-3 h-80 w-full"}
        option={option}
      />
      {!compact ? (
        <p className="text-sm leading-6 text-[var(--ledger-muted)]">
          {history.length}{t("charts.trend.pointSummaryMiddle")}{valuedDays}{t("charts.trend.pointSummarySuffix")}
          {missingDays > 0 ? `${t("charts.trend.missingPrefix")}${missingDays}${t("charts.trend.missingSuffix")}` : ""}{t("charts.trend.period")}
        </p>
      ) : null}
      {unreliableCostDays > 0 ? (
        <p className="mt-1 text-sm font-medium text-amber-800">
          {unreliableCostDays}{t("charts.trend.unreliableSuffix")}
        </p>
      ) : null}
      {range === "1d" ? (
        <p className="mt-1 text-sm font-medium text-amber-800">
          {t("charts.trend.singleDay")}
        </p>
      ) : null}
    </article>
  );
}
