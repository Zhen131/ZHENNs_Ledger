"use client";

import { useEffect, useRef, useState } from "react";

import type { LedgerData, Position, Trade, ValuationPriceMode } from "@/core/models";
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
  onNavigateToTransactions: (intent?: {
    filterDate?: string;
    expandTradeId?: string;
    clearFilters?: true;
  }) => void;
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

  const latestTrades = getLatestTrades(ledgerData.trades, 4);
  const hasNonZeroHoldings = positions.some(
    (position) => !isZero(position.quantity),
  );

  return (
    <section
      aria-label="首页工作区"
      className="grid min-w-0 gap-4"
      data-workspace-page="home"
    >
      {ledgerData.trades.length === 0 ? (
        <SurfaceCard className="flex items-center justify-between gap-4 border-[var(--ledger-border-strong)] bg-[var(--ledger-accent-soft)] p-4">
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

      <div className="grid grid-cols-2 gap-3 xl:grid-cols-4">
        <MetricCard
          label="当前总市值"
          metric={
            hasNonZeroHoldings ? allocation.totalMarketValue : "0"
          }
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

      <div className="grid min-w-0 gap-4 xl:grid-cols-[minmax(0,1.65fr)_minmax(260px,.75fr)]">
        <SurfaceCard className="min-w-0 p-4">
          <div className="mb-2 flex flex-wrap items-center justify-between gap-3">
            <div>
              <h2 className="font-semibold">资产趋势</h2>
              <p className="mt-1 text-xs text-[var(--ledger-muted)]">
                只展示账本真实事实推导的总市值与剩余含费成本。
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
              className="h-6 w-6 text-[var(--ledger-accent-strong)] transition-transform group-hover:translate-x-1"
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

      <div className="grid min-w-0 gap-4 xl:grid-cols-3">
        <SurfaceCard className="min-w-0 p-4">
          <HoldingsOverview
            onShowAll={openDetails}
            positions={positions}
            triggerRef={holdingsTriggerRef}
          />
        </SurfaceCard>
        <TradeHeatmapChart
          compact
          heatmap={heatmap}
          onSelectedTradeDateChange={(date) => {
            if (date) onNavigateToTransactions({ filterDate: date });
          }}
          selectedTradeDate={null}
        />
        <SurfaceCard className="min-w-0 p-4">
          <div className="flex items-center justify-between gap-3">
            <h3 className="font-semibold">最近交易</h3>
            <button
              className="text-sm font-semibold text-[var(--ledger-accent-strong)]"
              onClick={() => onNavigateToTransactions({ clearFilters: true })}
              type="button"
            >
              查看全部交易
            </button>
          </div>
          {latestTrades.length === 0 ? (
            <p className="mt-3 text-sm text-[var(--ledger-muted)]">
              暂无交易。
            </p>
          ) : (
            <ul className="mt-3 grid gap-2 text-sm">
              {latestTrades.map((trade) => (
                <li key={trade.id}>
                  <button
                    className="flex w-full items-center justify-between gap-3 rounded-xl px-2 py-2 text-left hover:bg-[var(--ledger-surface-muted)]"
                    onClick={() =>
                      onNavigateToTransactions({ expandTradeId: trade.id })
                    }
                    type="button"
                  >
                    <span>
                      <strong>{trade.assetSymbol}</strong>
                      <span className="ml-2 text-xs text-[var(--ledger-muted)]">
                        {trade.type === "buy" ? "买入" : "卖出"} ·{" "}
                        {trade.occurredAt}
                      </span>
                    </span>
                    <span className="ledger-numeric">
                      {trade.totalValue} {trade.currency}
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </SurfaceCard>
      </div>

      <HoldingsDetails
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
    <SurfaceCard className="min-w-0 p-4">
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

export function getLatestTrades(
  trades: readonly Trade[],
  limit: number,
): Trade[] {
  return trades
    .map((trade, originalIndex) => ({ trade, originalIndex }))
    .sort((left, right) => {
      const dateOrder = right.trade.occurredAt.localeCompare(
        left.trade.occurredAt,
      );
      return dateOrder === 0
        ? left.originalIndex - right.originalIndex
        : dateOrder;
    })
    .slice(0, limit)
    .map(({ trade }) => trade);
}
