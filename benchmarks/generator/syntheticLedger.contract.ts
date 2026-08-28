import { access } from "node:fs/promises";

import { replayPositions, replayUsdtCash } from "@/core/calculations";
import { validateLedgerData } from "@/core/validation";
import { validateBackupEnvelope } from "@/features/backup/backupEnvelope";
import { describe, expect, it } from "vitest";

import {
  createSyntheticBackupEnvelope,
  generateSyntheticLedger,
  withSyntheticBackupFile,
} from "./syntheticLedger";

describe("synthetic ledger generator contract", () => {
  it("T1-01 reproduces every field for one seed and scale", () => {
    const first = generateSyntheticLedger({ scale: "S-1K", seed: "same" });
    const second = generateSyntheticLedger({ scale: "S-1K", seed: "same" });
    expect(first).toEqual(second);
  });

  it.each(["S-100", "S-1K"] as const)(
    "T1-02 validates every fact in %s",
    (scale) => {
      const result = generateSyntheticLedger({ scale });
      expect(validateLedgerData(result.ledgerData)).toEqual({
        ok: true,
        value: result.ledgerData,
      });
    },
  );

  it.each(["S-100", "S-1K"] as const)(
    "T1-03 preserves the required fact ratios in %s",
    (scale) => {
      const { ledgerData } = generateSyntheticLedger({ scale });
      expect(ledgerData.cashEvents).toHaveLength(ledgerData.trades.length * 0.4);
      expect(ledgerData.priceSnapshots).toHaveLength(
        ledgerData.trades.length * 0.15,
      );
      expect(ledgerData.assetTransfers).toHaveLength(
        ledgerData.trades.length * 0.05,
      );
      expect(ledgerData.assets.length).toBeGreaterThanOrEqual(10);
      expect(ledgerData.assets.length).toBeLessThanOrEqual(20);
    },
  );

  it("T1-04 includes all four transfer categories in S-1K", () => {
    const categories = new Set(
      generateSyntheticLedger({ scale: "S-1K" }).ledgerData.assetTransfers.map(
        ({ category }) => category,
      ),
    );
    expect(categories).toEqual(
      new Set(["internal", "external-in", "external-out", "gain"]),
    );
  });

  it("T1-05 changes the ledger when the seed changes", () => {
    const first = generateSyntheticLedger({ scale: "S-100", seed: "first" });
    const second = generateSyntheticLedger({ scale: "S-100", seed: "second" });
    expect(first.ledgerData).not.toEqual(second.ledgerData);
  });

  it("T1-06 survives position, cash and backup replay", () => {
    const result = generateSyntheticLedger({ scale: "S-1K" });
    expect(() =>
      replayPositions(result.ledgerData.trades, result.ledgerData.assetTransfers),
    ).not.toThrow();
    expect(() => replayUsdtCash(result.ledgerData)).not.toThrow();
    expect(validateBackupEnvelope(createSyntheticBackupEnvelope(result))).toEqual({
      ok: true,
      value: createSyntheticBackupEnvelope(result),
    });
  });

  it("T1-07 keeps every fact on or before synthetic today", () => {
    const result = generateSyntheticLedger({ scale: "S-1K" });
    const timestamps = [
      ...result.ledgerData.trades.map(({ occurredAt }) => occurredAt),
      ...result.ledgerData.cashEvents.map(({ occurredAt }) => occurredAt),
      ...result.ledgerData.assetTransfers.map(({ occurredAt }) => occurredAt),
      ...result.ledgerData.priceSnapshots.map(({ recordedAt }) => recordedAt),
    ];
    expect(timestamps.every((value) => value.slice(0, 10) <= result.todayKey)).toBe(
      true,
    );
  });

  it("writes generated backup data only under an auto-cleaned temp directory", async () => {
    let path = "";
    await withSyntheticBackupFile(
      generateSyntheticLedger({ scale: "S-100" }),
      async (filePath) => {
        path = filePath;
        expect(filePath).toContain("lftl-benchmark-");
        await expect(access(filePath)).resolves.toBeUndefined();
      },
    );
    await expect(access(path)).rejects.toThrow();
  });
});
