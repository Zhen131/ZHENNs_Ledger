"use client";

import { useMemo } from "react";

import type { TradeHeatmapDay } from "./chartDataService";
import { buildTradeHeatmapChartOption } from "./chartOptionBuilders";
import { EChart } from "./EChart";

export function TradeHeatmapChart({
  heatmap,
  selectedTradeDate,
  onSelectedTradeDateChange,
  compact = false,
}: Readonly<{
  heatmap: readonly TradeHeatmapDay[];
  selectedTradeDate: string | null;
  onSelectedTradeDateChange: (date: string | null) => void;
  compact?: boolean;
}>) {
  const option = useMemo(
    () => buildTradeHeatmapChartOption(heatmap),
    [heatmap],
  );
  const events = useMemo(
    () => ({
      click: (params: unknown) => {
        const date = readHeatmapDate(params);
        if (!date) return;
        onSelectedTradeDateChange(
          selectedTradeDate === date ? null : date,
        );
      },
    }),
    [onSelectedTradeDateChange, selectedTradeDate],
  );
  const totalTrades = heatmap.reduce((total, day) => total + day.total, 0);

  return (
    <article className="min-w-0 overflow-hidden rounded-2xl border border-[var(--ledger-border)] bg-[var(--ledger-surface)] p-4 min-[1100px]:p-3">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h3 className="font-semibold text-[var(--ledger-ink)]">
            最近 365 天交易活跃
          </h3>
          {!compact ? (
            <p className="mt-1 text-xs leading-5 text-[var(--ledger-muted)]">
              一周一列、星期为行；共 {heatmap.length} 个自然日、
              {totalTrades} 笔交易。
            </p>
          ) : null}
        </div>
        {selectedTradeDate ? (
          <button
            className="rounded-lg border border-[var(--ledger-border)] bg-white px-3 py-1.5 text-sm font-medium text-[var(--ledger-muted)]"
            onClick={() => onSelectedTradeDateChange(null)}
            type="button"
          >
            清除日期筛选
          </button>
        ) : null}
      </div>
      <EChart
        ariaLabel="最近 365 天交易活跃热力图"
        className={
          compact
            ? "mt-2 h-32 w-full min-[1100px]:h-24"
            : "mt-3 h-56 w-full"
        }
        events={events}
        option={option}
      />
      {!compact ? (
        <p className="text-sm leading-6 text-[var(--ledger-muted)]">
          活跃等级：无交易 / 低 / 较低 / 较高 / 最高。{" "}
          {selectedTradeDate
            ? `当前筛选 ${selectedTradeDate} 的交易，再点同一天可取消。`
            : "点击日期格可筛选交易列表。"}
        </p>
      ) : null}
    </article>
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
