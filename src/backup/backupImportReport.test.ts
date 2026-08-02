import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

import { preflightBackupJson } from "./backupImportPreflight";
import { formatBackupImportReportMarkdown } from "./backupImportReport";

const TODAY = "2026-07-31";

describe("formatBackupImportReportMarkdown", () => {
  it("starts with a privacy warning and includes totals, paths, summaries and real duplicate edges", async () => {
    const result = await preflight(
      readFixture("preflight-errors-and-duplicates.backup.json"),
    );

    const report = formatBackupImportReportMarkdown(result);

    expect(report).toMatch(
      /^# Historical B Import Preflight Report\n\n> Privacy notice: this report may contain sensitive trade dates, assets, directions, quantities, and amounts/,
    );
    expect(report).toContain(`Hard error count: ${result.hardErrorCount}`);
    expect(report).toContain(
      `Suspicious duplicate group count: ${result.suspiciousGroupCount}`,
    );
    expect(report).toContain("`trades[0].quantity`");
    expect(report).toContain("`trades[7].rawText`");
    expect(report).toContain("Trade summary: Date 2026-04-01");
    expect(report).toContain("Highly Suspicious Duplicate Group");
    expect(report).toContain("Suspicious Duplicate Group");
    expect(report).toContain("Trigger edges");
    expect(report).toContain("did not automatically modify, delete, merge, or deduplicate");
    expect(report).not.toContain("Synthetic BTC invalid-quantity record");
  });

  it("copies only the retained first 1000 details while preserving the true 1001 total and truncation warning", async () => {
    const result = await preflight(
      readFixture("report-1001.backup.json"),
    );

    const report = formatBackupImportReportMarkdown(result);

    expect(report).toContain("Total detail count: 1001");
    expect(report).toContain("Retained report details: 1000");
    expect(report).toContain("`trades[999].quantity`");
    expect(report).not.toContain("`trades[1000].quantity`");
    expect(report).toContain(
      "Details after item 1000 were truncated; correct the data and run the check again",
    );
  });

  it("reports skipped checks and an honest JSON position", async () => {
    const result = await preflight("{\n invalid");
    const report = formatBackupImportReportMarkdown(result);

    expect(report).toContain("## Skipped Checks");
    expect(report).toContain("`backup-envelope`");
    expect(report).toContain("`BACKUP_BAD_JSON`");
    expect(report).toContain("`file`");
    if (result.retainedDetails[0]?.kind === "hard-error") {
      if (result.retainedDetails[0].line === undefined) {
        expect(report).toContain("did not provide a reliable line and column");
      } else {
        expect(report).toContain(
          `JSON location: line ${result.retainedDetails[0].line}, column ${result.retainedDetails[0].column}`,
        );
      }
    }
  });
});

function preflight(serialized: string) {
  return preflightBackupJson(serialized, {
    todayKey: TODAY,
    selectionGeneration: 1,
    requireHistoricalRawText: true,
  });
}

function readFixture(name: string): string {
  return readFileSync(
    new URL(`../../test-fixtures/w11-b-import/${name}`, import.meta.url),
    "utf8",
  );
}
