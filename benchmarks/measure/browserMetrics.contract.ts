import { describe, expect, it } from "vitest";

import { runBrowserBenchmark } from "./browserMetrics";

describe("browser performance ruler contract", () => {
  it(
    "T3-01 to T3-05 loads through the real file path and samples S-100",
    async () => {
      const result = await runBrowserBenchmark({
        mode: "dev",
        scale: "S-100",
        sampleCount: 1,
      });
      expect(result.status).toBe("completed");
      if (result.status !== "completed") return;
      expect(result.wrongPasswordRejected).toBe(true);
      expect(result.pickerCalls.save).toBeGreaterThanOrEqual(1);
      expect(result.pickerCalls.open).toBeGreaterThanOrEqual(2);
      expect(new Set(result.metrics.map(({ metric }) => metric))).toEqual(
        new Set(["M-1", "M-3", "M-4", "M-5", "M-6"]),
      );
      expect(result.metrics.every(({ statistics }) => statistics.sampleCount === 1)).toBe(
        true,
      );
      expect(result.temporaryArtifactsCleaned).toBe(true);
    },
    180_000,
  );
});
