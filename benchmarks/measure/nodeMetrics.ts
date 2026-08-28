import { performance } from "node:perf_hooks";
import { pathToFileURL } from "node:url";

import { replayPositions, replayUsdtCash } from "@/core/calculations";
import type { LedgerData } from "@/core/models";
import {
  buildHoldingAllocation,
  buildHoldingHistory,
  buildTradeHeatmap,
  type ChartRange,
} from "@/features/charts/chartDataService";
import { buildLedgerPnlSummary } from "@/features/portfolio/pnlSummaryService";
import { buildLedgerProjection } from "@/features/portfolio/ledgerProjection";

import {
  generateSyntheticLedger,
  SYNTHETIC_SCALE_TRADE_COUNTS,
  type SyntheticScale,
} from "../generator/syntheticLedger";
import {
  roundDuration,
  summarizeDurations,
  type DurationStatistics,
} from "./report";

export const NODE_HISTORY_RANGES = [
  "1d",
  "7d",
  "30d",
  "365d",
  "all",
] as const satisfies readonly ChartRange[];

export type NodeMetricSelection = "M-2" | "M-7" | "M-8" | "all";

export type NodeMetricResult = Readonly<{
  metric: "M-2" | "M-7" | "M-8";
  scale: SyntheticScale;
  range?: ChartRange;
  statistics: DurationStatistics;
  samplesMs: readonly number[];
  discardedWarmupMs: number;
  rssBytesAfterSampling: number;
}>;

export type NodeBenchmarkResult = Readonly<{
  kind: "node-benchmark";
  scale: SyntheticScale;
  tradeCount: number;
  samplesPerMetric: number;
  generatedFactCounts: Readonly<{
    assets: number;
    trades: number;
    cashEvents: number;
    assetTransfers: number;
    priceSnapshots: number;
  }>;
  metrics: readonly NodeMetricResult[];
  rootCauseRatios: readonly Readonly<{
    range: ChartRange;
    historyMedianMs: number;
    replayMedianMs: number;
    ratio: number;
    intervalDays: number;
  }>[];
}>;

export type RunNodeBenchmarkOptions = Readonly<{
  scale: SyntheticScale;
  sampleCount?: number;
  metric?: NodeMetricSelection;
  range?: ChartRange;
}>;

export function runNodeBenchmark(
  options: RunNodeBenchmarkOptions,
): NodeBenchmarkResult {
  const sampleCount = options.sampleCount ?? defaultSampleCount(options.scale);
  if (!Number.isInteger(sampleCount) || sampleCount < 1) {
    throw new Error("Node benchmark sample count must be a positive integer");
  }
  if (options.metric !== "M-7" && options.range !== undefined) {
    throw new Error("A history range can only be selected with M-7");
  }

  const generated = generateSyntheticLedger({ scale: options.scale });
  const { ledgerData, todayKey } = generated;
  const metrics: NodeMetricResult[] = [];
  const selectedMetric = options.metric ?? "all";

  if (selectedMetric === "all" || selectedMetric === "M-2") {
    metrics.push(
      sampleMetric("M-2", options.scale, sampleCount, () =>
        runDashboardDerivations(ledgerData, todayKey),
      ),
    );
  }

  if (selectedMetric === "all" || selectedMetric === "M-7") {
    const ranges = options.range ? [options.range] : NODE_HISTORY_RANGES;
    for (const range of ranges) {
      metrics.push(
        sampleMetric(
          "M-7",
          options.scale,
          sampleCount,
          () =>
            buildHoldingHistory(ledgerData, {
              todayKey,
              mode: "auto",
              range,
            }),
          range,
        ),
      );
    }
  }

  if (selectedMetric === "all" || selectedMetric === "M-8") {
    metrics.push(
      sampleMetric("M-8", options.scale, sampleCount, () => {
        replayPositions(ledgerData.trades, ledgerData.assetTransfers);
        replayUsdtCash(ledgerData);
      }),
    );
  }

  const replayMedian = metrics.find(({ metric }) => metric === "M-8")
    ?.statistics.medianMs;
  const rootCauseRatios =
    replayMedian === undefined
      ? []
      : metrics
          .filter(
            (metric): metric is NodeMetricResult & { range: ChartRange } =>
              metric.metric === "M-7" && metric.range !== undefined,
          )
          .map((metric) => ({
            range: metric.range,
            historyMedianMs: metric.statistics.medianMs,
            replayMedianMs: replayMedian,
            ratio: roundDuration(metric.statistics.medianMs / replayMedian),
            intervalDays: historyIntervalDays(metric.range, generated.spanDays),
          }));

  return {
    kind: "node-benchmark",
    scale: options.scale,
    tradeCount: SYNTHETIC_SCALE_TRADE_COUNTS[options.scale],
    samplesPerMetric: sampleCount,
    generatedFactCounts: {
      assets: ledgerData.assets.length,
      trades: ledgerData.trades.length,
      cashEvents: ledgerData.cashEvents.length,
      assetTransfers: ledgerData.assetTransfers.length,
      priceSnapshots: ledgerData.priceSnapshots.length,
    },
    metrics,
    rootCauseRatios,
  };
}

function runDashboardDerivations(ledgerData: LedgerData, todayKey: string): void {
  const projection = buildLedgerProjection(ledgerData, {
    asOf: todayKey,
    mode: "auto",
  });
  buildLedgerPnlSummary(ledgerData, { todayKey, mode: "auto" });
  buildHoldingAllocation(ledgerData, {
    todayKey,
    mode: "auto",
    projection,
  });
  buildHoldingHistory(ledgerData, {
    todayKey,
    mode: "auto",
    range: "30d",
  });
  buildTradeHeatmap(ledgerData, todayKey);
}

function sampleMetric(
  metric: "M-2" | "M-7" | "M-8",
  scale: SyntheticScale,
  sampleCount: number,
  operation: () => unknown,
  range?: ChartRange,
): NodeMetricResult {
  const discardedWarmupMs = measure(operation);
  const samplesMs = Array.from({ length: sampleCount }, () => measure(operation));
  return {
    metric,
    scale,
    ...(range === undefined ? {} : { range }),
    statistics: summarizeDurations(samplesMs),
    samplesMs: samplesMs.map(roundDuration),
    discardedWarmupMs: roundDuration(discardedWarmupMs),
    rssBytesAfterSampling: process.memoryUsage().rss,
  };
}

function measure(operation: () => unknown): number {
  const start = performance.now();
  operation();
  return performance.now() - start;
}

function defaultSampleCount(scale: SyntheticScale): number {
  if (scale === "S-1M") return 1;
  if (scale === "S-100K") return 3;
  return 10;
}

function historyIntervalDays(range: ChartRange, spanDays: number): number {
  if (range === "all") return spanDays;
  return Number.parseInt(range, 10);
}

function parseArguments(argv: readonly string[]): RunNodeBenchmarkOptions {
  let scale: SyntheticScale = "S-100";
  let sampleCount: number | undefined;
  let metric: NodeMetricSelection = "all";
  let range: ChartRange | undefined;

  for (const argument of argv) {
    const [name, value] = argument.split("=", 2);
    if (name === "--scale" && isSyntheticScale(value)) {
      scale = value;
    } else if (name === "--samples" && value !== undefined) {
      sampleCount = Number.parseInt(value, 10);
    } else if (
      name === "--metric" &&
      (value === "M-2" || value === "M-7" || value === "M-8" || value === "all")
    ) {
      metric = value;
    } else if (name === "--range" && isChartRange(value)) {
      range = value;
    } else {
      throw new Error(`Unsupported node benchmark argument: ${argument}`);
    }
  }
  return { scale, sampleCount, metric, range };
}

function isSyntheticScale(value: string | undefined): value is SyntheticScale {
  return value !== undefined && value in SYNTHETIC_SCALE_TRADE_COUNTS;
}

function isChartRange(value: string | undefined): value is ChartRange {
  return (
    value === "1d" ||
    value === "7d" ||
    value === "30d" ||
    value === "365d" ||
    value === "all"
  );
}

const invokedPath = process.argv[1];
if (invokedPath && import.meta.url === pathToFileURL(invokedPath).href) {
  const result = runNodeBenchmark(parseArguments(process.argv.slice(2)));
  process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
}
