import type {
  HoldingAllocation,
  HoldingHistoryPoint,
  TradeHeatmapDay,
} from "../../services/chartDataService";

export function ChartOverviewSummary({
  allocation,
  history,
  heatmap,
}: Readonly<{
  allocation: HoldingAllocation;
  history: readonly HoldingHistoryPoint[];
  heatmap: readonly TradeHeatmapDay[];
}>) {
  const valuedHistoryDays = history.filter(
    (point) => point.totalMarketValue !== undefined,
  ).length;
  const tradeCount = heatmap.reduce((total, day) => total + day.total, 0);

  return (
    <div
      aria-label="三图数据摘要"
      className="grid gap-4 lg:grid-cols-3"
    >
      <article className="rounded-md border border-slate-200 bg-slate-50 p-4">
        <h3 className="font-semibold text-slate-950">
          当前 USD 等值持仓分配
        </h3>
        {allocation.slices.length > 0 ? (
          <p className="mt-2 text-sm leading-6 text-slate-600">
            已估值 {allocation.slices.length} 项，总市值{" "}
            {allocation.totalMarketValue} USD 等值。
          </p>
        ) : allocation.missingPriceAssets.length > 0 ? (
          <p className="mt-2 text-sm leading-6 text-amber-800">
            非零持仓缺少合法价格，当前不绘制误导性分配。
          </p>
        ) : (
          <p className="mt-2 text-sm leading-6 text-slate-600">
            当前没有可显示的非零 USD/USDT 持仓。
          </p>
        )}
      </article>

      <article className="rounded-md border border-slate-200 bg-slate-50 p-4">
        <h3 className="font-semibold text-slate-950">
          持仓总市值 / 持仓成本
        </h3>
        <p className="mt-2 text-sm leading-6 text-slate-600">
          当前 30 日窗口包含 {history.length} 个日级点，其中{" "}
          {valuedHistoryDays} 个点具备完整合法市场价格。
        </p>
        <p className="mt-1 text-xs leading-5 text-slate-500">
          不含现金，不代表账户净值；成本暂不计手续费。
        </p>
      </article>

      <article className="rounded-md border border-slate-200 bg-slate-50 p-4">
        <h3 className="font-semibold text-slate-950">
          最近 365 天交易活跃
        </h3>
        <p className="mt-2 text-sm leading-6 text-slate-600">
          {heatmap.length} 个自然日共记录 {tradeCount} 笔买入或卖出交易。
        </p>
      </article>
    </div>
  );
}
