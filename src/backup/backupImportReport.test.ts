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
      /^# B 历史导入预检报告\n\n> 隐私提醒：本报告可能包含交易日期、资产、买卖方向、数量和金额等敏感信息/,
    );
    expect(report).toContain(`硬错误总数：${result.hardErrorCount}`);
    expect(report).toContain(
      `可疑重复组总数：${result.suspiciousGroupCount}`,
    );
    expect(report).toContain("`trades[0].quantity`");
    expect(report).toContain("`trades[7].rawText`");
    expect(report).toContain("交易摘要：日期 2026-04-01");
    expect(report).toContain("高度可疑重复组");
    expect(report).toContain("一般可疑重复组");
    expect(report).toContain("真实触发关系");
    expect(report).toContain("没有自动修改、删除、合并或去重");
    expect(report).not.toContain("虚构 BTC 非法数量记录");
  });

  it("copies only the retained first 1000 details while preserving the true 1001 total and truncation warning", async () => {
    const result = await preflight(
      readFixture("report-1001.backup.json"),
    );

    const report = formatBackupImportReportMarkdown(result);

    expect(report).toContain("详情总数：1001");
    expect(report).toContain("报告保留详情：1000");
    expect(report).toContain("`trades[999].quantity`");
    expect(report).not.toContain("`trades[1000].quantity`");
    expect(report).toContain(
      "第 1001 项后已截断，请修正后重新检查",
    );
  });

  it("reports skipped checks and an honest JSON position", async () => {
    const result = await preflight("{\n invalid");
    const report = formatBackupImportReportMarkdown(result);

    expect(report).toContain("## 未执行的检查");
    expect(report).toContain("`backup-envelope`");
    expect(report).toContain("`BACKUP_BAD_JSON`");
    expect(report).toContain("`file`");
    if (result.retainedDetails[0]?.kind === "hard-error") {
      if (result.retainedDetails[0].line === undefined) {
        expect(report).toContain("没有提供可靠的行列位置");
      } else {
        expect(report).toContain(
          `JSON 位置：第 ${result.retainedDetails[0].line} 行，第 ${result.retainedDetails[0].column} 列`,
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
