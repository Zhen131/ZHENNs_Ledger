import { describe, expect, it } from "vitest";

import { runRenderedElementCountBenchmark } from "./browserMetrics";

describe("M-9 rendered element count contract", () => {
  it(
    "measures the complete document and transactions subtree twice with identical counts",
    async () => {
      const result = await runRenderedElementCountBenchmark({
        mode: "dev",
        scale: "S-100",
      });

      expect(result.status).toBe("completed");
      if (result.status !== "completed") return;
      expect(result.measurementsMatch).toBe(true);
      expect(result.first.documentElements).toBeGreaterThan(0);
      expect(result.first.transactionsWorkspaceElements).toBeGreaterThan(0);
      expect(result.first.homeWorkspaceElements).toBeGreaterThanOrEqual(0);
      expect(result.first.recordWorkspaceElements).toBeGreaterThan(0);
      expect(result.first.transferWorkspaceElements).toBeGreaterThan(0);
      expect(result.first.settingsWorkspaceElements).toBeGreaterThan(0);
      expect(result.first).toEqual(result.second);
      expect(result.temporaryArtifactsCleaned).toBe(true);
    },
    180_000,
  );
});
