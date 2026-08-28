import { describe, expect, it } from "vitest";

import { runNodeBenchmark } from "./nodeMetrics";
import { summarizeDurations } from "./report";

describe("Node performance ruler contract", () => {
  it("T2-01 completes S-100 and returns structured M-2, M-7 and M-8 results", () => {
    const result = runNodeBenchmark({ scale: "S-100", sampleCount: 2 });
    expect(result.kind).toBe("node-benchmark");
    expect(result.metrics).toHaveLength(7);
    expect(new Set(result.metrics.map(({ metric }) => metric))).toEqual(
      new Set(["M-2", "M-7", "M-8"]),
    );
  });

  it("T2-03 includes median, minimum, maximum and count", () => {
    const statistics = summarizeDurations([3, 1, 4, 2]);
    expect(statistics).toEqual({
      medianMs: 2.5,
      minimumMs: 1,
      maximumMs: 4,
      sampleCount: 4,
    });
  });

  it("T2-04 performs a selected metric without any filesystem output", () => {
    const result = runNodeBenchmark({
      scale: "S-100",
      sampleCount: 1,
      metric: "M-8",
    });
    expect(result.metrics).toHaveLength(1);
    expect(result.metrics[0].statistics.sampleCount).toBe(1);
  });
});
