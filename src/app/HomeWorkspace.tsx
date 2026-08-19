"use client";

import { useEffect, useRef, useState } from "react";

import type { LedgerData, Position, ValuationPriceMode } from "@/core/models";
import { isZero } from "@/core/shared";
import type { LedgerPnlSummary, SummaryMetric } from "@/features/portfolio";
import type {
  ChartRange,
  HoldingAllocation,
  HoldingHistoryPoint,
  TradeHeatmapDay,
} from "@/features/charts";
import {
  HoldingAllocationChart,
  HoldingTrendChart,
  TradeHeatmapChart,
} from "@/features/charts/ui";
import { HoldingsDetails, HoldingsOverview } from "@/features/portfolio/ui";
import { LedgerIcon, SurfaceCard } from "@/ui";

export function HomeWorkspace({
  active,
  ledgerData,
  positions,
  cashBalance,
  pnlSummary,
  allocation,
  history,
  heatmap,
  range,
  valuationPriceMode,
  onRangeChange,
  onValuationPriceModeChange,
  onNavigateToTrade,
  onNavigateToPrice,
  onNavigateToTransactions,
}: Readonly<{
  active: boolean;
  ledgerData: LedgerData;
  positions: readonly Position[];
  cashBalance: string;
  pnlSummary: LedgerPnlSummary;
  allocation: HoldingAllocation;
  history: readonly HoldingHistoryPoint[];
  heatmap: readonly TradeHeatmapDay[];
  range: ChartRange;
  valuationPriceMode: ValuationPriceMode;
  onRangeChange: (range: ChartRange) => void;
  onValuationPriceModeChange: (mode: ValuationPriceMode) => void;
  onNavigateToTrade: () => void;
  onNavigateToPrice: () => void;
  onNavigateToTransactions: (
    intent: { locateDate: string } | { clearFilters: true },
  ) => void;
}>) {
  const [detailsOpen, setDetailsOpen] = useState(false);
  const holdingsTriggerRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (active) return;
    setDetailsOpen(false);
  }, [active]);

  function closeDetails() {
    setDetailsOpen(false);
    requestAnimationFrame(() => holdingsTriggerRef.current?.focus());
  }

  function openDetails() {
    setDetailsOpen(true);
  }

  if (!active) return null;

  const hasNonZeroHoldings = positions.some(
    (position) => !isZero(position.quantity),
  );

  return (
    <section
      aria-label="首页工作区"
      className="grid min-w-0 gap-4 min-[1100px]:gap-3"
      data-workspace-page="home"
    >
      {ledgerData.trades.length === 0 ? (
        <SurfaceCard className="flex flex-col items-start justify-between gap-4 border-[var(--ledger-border-strong)] bg-[var(--ledger-accent-soft)] p-4 sm:flex-row sm:items-center">
          <div>
            <h2 className="font-semibold">还没有交易记录</h2>
            <p className="mt-1 text-sm text-[var(--ledger-muted)]">
              记录第一笔交易后，持仓、盈亏和图表会由同一份账本自动推导。
            </p>
          </div>
          <button
            className="shrink-0 rounded-xl bg-[var(--ledger-accent-strong)] px-4 py-2.5 text-sm font-semibold text-white"
            onClick={onNavigateToTrade}
            type="button"
          >
            记录第一笔交易
          </button>
        </SurfaceCard>
      ) : null}

      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 min-[1100px]:grid-cols-4">
        <MetricCard
          label="当前总资产"
          metric={allocation.totalMarketValue}
          missing={allocation.missingPriceAssets}
          valuationLabel={allocation.valuation.label}
        />
        <MetricCard
          label="剩余持仓成本"
          metric={pnlSummary.remainingCostBasis}
          valuationLabel={pnlSummary.valuation.label}
        />
        <MetricCard
          label="未实现盈亏"
          metric={pnlSummary.unrealizedPnl}
          valuationLabel={pnlSummary.valuation.label}
        />
        <MetricCard
          label="已实现盈亏"
          metric={pnlSummary.realizedPnl}
          valuationLabel={pnlSummary.valuation.label}
        />
      </div>

      <div className="grid min-w-0 gap-4 min-[1100px]:grid-cols-[minmax(0,1.65fr)_minmax(260px,.75fr)]">
        <SurfaceCard className="min-w-0 p-4 min-[1100px]:p-3">
          <div className="mb-2 flex flex-wrap items-center justify-between gap-3">
            <div>
              <h2 className="font-semibold">资产趋势</h2>
              <p className="mt-1 text-xs text-[var(--ledger-muted)]">
                总资产逐日重放现金与可得行情；成本线仍只读取交易。
              </p>
            </div>
            <div className="flex flex-wrap gap-2">
              <label className="grid gap-1 text-xs font-medium text-[var(--ledger-muted)]">
                价格来源
                <select
                  aria-label="估值价格模式"
                  className="rounded-lg border border-[var(--ledger-border)] bg-white px-2.5 py-1.5 text-sm text-[var(--ledger-ink)]"
                  onChange={(event) =>
                    onValuationPriceModeChange(
                      event.target.value as ValuationPriceMode,
                    )
                  }
                  value={valuationPriceMode}
                >
                  <option value="auto">自动选择</option>
                  <option value="manual">优先手动</option>
                </select>
              </label>
              <label className="grid gap-1 text-xs font-medium text-[var(--ledger-muted)]">
                范围
                <select
                  aria-label="持仓历史范围"
                  className="rounded-lg border border-[var(--ledger-border)] bg-white px-2.5 py-1.5 text-sm text-[var(--ledger-ink)]"
                  onChange={(event) =>
                    onRangeChange(event.target.value as ChartRange)
                  }
                  value={range}
                >
                  <option value="1d">1 日</option>
                  <option value="7d">7 日</option>
                  <option value="30d">30 日</option>
                  <option value="365d">365 日</option>
                  <option value="all">全部</option>
                </select>
              </label>
            </div>
          </div>
          <HoldingTrendChart
            compact
            history={history}
            onRangeChange={onRangeChange}
            range={range}
            showRangeControl={false}
          />
        </SurfaceCard>

        <div className="grid gap-4">
          <button
            className="group flex min-h-24 items-center justify-between gap-4 rounded-[20px] border border-[var(--ledger-border-strong)] bg-[var(--ledger-accent-soft)] p-5 text-left shadow-[var(--ledger-shadow-soft)]"
            onClick={onNavigateToTrade}
            type="button"
          >
            <span>
              <strong className="block text-lg">记一笔交易</strong>
              <span className="mt-1 block text-sm text-[var(--ledger-muted)]">
                新增真实买入或卖出事实
              </span>
            </span>
            <LedgerIcon
              className="h-6 w-6 text-[var(--ledger-accent-strong)] transition-transform group-hover:translate-x-1 motion-reduce:transform-none motion-reduce:transition-none"
              name="arrow-right"
            />
          </button>
          <HoldingAllocationChart allocation={allocation} compact />
          {hasNonZeroHoldings && allocation.missingPriceAssets.length > 0 ? (
            <button
              className="rounded-xl border border-amber-200 bg-amber-50 px-3 py-2 text-left text-sm font-medium text-amber-900"
              onClick={onNavigateToPrice}
              type="button"
            >
              更新缺价资产：{allocation.missingPriceAssets.join("、")}
            </button>
          ) : null}
        </div>
      </div>

      <div className="grid min-w-0 items-stretch gap-4 min-[1100px]:grid-cols-[minmax(0,1fr)_minmax(0,2fr)]">
        <SurfaceCard className="min-w-0 p-4">
          <HoldingsOverview
            cashBalance={cashBalance}
            onShowAll={openDetails}
            positions={positions}
            triggerRef={holdingsTriggerRef}
          />
        </SurfaceCard>
        <TradeHeatmapChart
          heatmap={heatmap}
          onLocateDate={(date) => {
            onNavigateToTransactions({ locateDate: date });
          }}
          onViewAll={() =>
            onNavigateToTransactions({ clearFilters: true })
          }
          variant="home"
        />
      </div>

      <HoldingsDetails
        cashBalance={cashBalance}
        onClose={closeDetails}
        open={detailsOpen}
        positions={positions}
      />
    </section>
  );
}

function MetricCard({
  label,
  metric,
  valuationLabel,
  missing = [],
}: Readonly<{
  label: string;
  metric: SummaryMetric | string | undefined;
  valuationLabel: string;
  missing?: readonly string[];
}>) {
  const metricValue =
    typeof metric === "string" || metric === undefined ? metric : metric.value;
  const missingReasons =
    typeof metric === "object" ? metric.missingReasons : missing;
  return (
    <SurfaceCard className="min-w-0 p-4 min-[1100px]:p-3">
      <h2 className="text-xs font-medium text-[var(--ledger-muted)]">{label}</h2>
      <p className="ledger-numeric mt-2 truncate text-xl font-semibold">
        {metricValue === undefined
          ? "不可完整计算"
          : `${metricValue} ${valuationLabel}`}
      </p>
      {missingReasons.length > 0 ? (
        <p className="mt-1 truncate text-xs font-medium text-amber-800">
          未计入：{missingReasons.join("、")}
        </p>
      ) : null}
    </SurfaceCard>
  );
}
