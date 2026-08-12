"use client";

import type {
  ChartRange,
  HoldingAllocation,
  HoldingHistoryPoint,
  TradeHeatmapDay,
} from "./chartDataService";
import { HoldingAllocationChart } from "./HoldingAllocationChart";
import { HoldingTrendChart } from "./HoldingTrendChart";
import { TradeHeatmapChart } from "./TradeHeatmapChart";

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
  return (
    <div className="grid min-w-0 gap-5">
      <HoldingAllocationChart allocation={allocation} />
      <HoldingTrendChart
        history={history}
        onRangeChange={onRangeChange}
        range={range}
      />
      <TradeHeatmapChart
        heatmap={heatmap}
        onSelectedTradeDateChange={onSelectedTradeDateChange}
        selectedTradeDate={selectedTradeDate}
      />
    </div>
  );
}
