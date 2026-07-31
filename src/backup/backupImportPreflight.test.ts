import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

import { DEFAULT_LEDGER_RESOURCE_LIMITS } from "../validators";
import { normalizeLedgerDataForRuntime } from "../policies/ledgerFactPolicy";
import { createLedgerDataContentIdentity } from "./backupContentIdentity";
import {
  BACKUP_PREFLIGHT_PAGE_DETAIL_LIMIT,
  BACKUP_PREFLIGHT_REPORT_DETAIL_LIMIT,
  confirmBackupImportSuspiciousGroups,
  createLedgerBackupImportEvidence,
  inspectLedgerBackupImportEvidence,
  preflightBackupJson,
  revokeBackupImportPreflightReceipt,
  type BackupPreflightSuspiciousDetail,
} from "./backupImportPreflight";

const TODAY = "2026-07-31";

describe("preflightBackupJson", () => {
  it("reads the permanent 300-trade fixture, preserves every rawText and returns a frozen candidate", async () => {
    const serialized = readFixture("valid-300.backup.json");
    const before = sha256(serialized);

    const result = await preflight(serialized, 7);

    expect(result.contentIdentity).toEqual({
      sha256: before,
      utf8ByteLength: Buffer.byteLength(serialized, "utf8"),
      value: `${before}:${Buffer.byteLength(serialized, "utf8")}`,
    });
    expect(result.selectionGeneration).toBe(7);
    expect(result.hardErrorCount).toBe(0);
    expect(result.suspiciousGroupCount).toBe(0);
    expect(result.candidate?.trades).toHaveLength(300);
    expect(result.candidate?.assets).toHaveLength(3);
    expect(result.candidate?.priceSnapshots).toHaveLength(1);
    expect(result.candidate?.feeRules).toHaveLength(1);
    expect(
      result.candidate?.trades.every(
        (trade, index) =>
          trade.rawText ===
          `虚构历史交易原句 ${index + 1}：买入测试资产，非真实用户数据。`,
      ),
    ).toBe(true);
    expect(Object.isFrozen(result)).toBe(true);
    expect(Object.isFrozen(result.candidate)).toBe(true);
    expect(Object.isFrozen(result.candidate?.trades)).toBe(true);
    expect(Object.isFrozen(result.candidate?.trades[0])).toBe(true);
    expect(sha256(serialized)).toBe(before);

    const evidence = createLedgerBackupImportEvidence(result);
    expect(evidence).not.toBeNull();
    if (!evidence) return;
    expect(inspectLedgerBackupImportEvidence(evidence)).toMatchObject({
      candidateIdentity: result.candidateIdentity,
      requireHistoricalRawText: true,
    });
    expect(
      inspectLedgerBackupImportEvidence({ ...evidence }),
    ).toBeNull();
    revokeBackupImportPreflightReceipt(result);
    expect(inspectLedgerBackupImportEvidence(evidence)).toBeNull();
  });

  it("binds suspicious confirmation to the exact signed preflight result", async () => {
    const serialized = readFixture(
      "suspicions-only.backup.json",
    );
    const first = await preflight(serialized, 1);
    const second = await preflight(serialized, 2);
    expect(first.suspiciousGroupCount).toBeGreaterThan(0);
    expect(second.suspiciousGroupCount).toBeGreaterThan(0);

    const firstConfirmation =
      confirmBackupImportSuspiciousGroups(first);
    const secondConfirmation =
      confirmBackupImportSuspiciousGroups(second);
    expect(firstConfirmation).not.toBeNull();
    expect(secondConfirmation).not.toBeNull();
    expect(
      createLedgerBackupImportEvidence(first),
    ).toBeNull();
    expect(
      createLedgerBackupImportEvidence(
        first,
        secondConfirmation,
      ),
    ).toBeNull();
    expect(
      createLedgerBackupImportEvidence(
        first,
        firstConfirmation,
      ),
    ).not.toBeNull();
  });

  it("reports the fixed 147th trade error and never creates a partial candidate", async () => {
    const result = await preflight(
      readFixture("invalid-trade-147.backup.json"),
    );

    expect(result.hardErrorCount).toBeGreaterThan(0);
    expect(result.retainedDetails).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          kind: "hard-error",
          path: "trades[146].quantity",
        }),
      ]),
    );
    expect(result.candidate).toBeUndefined();
  });

  it("uses one canonical candidate identity before and after legacy built-in Binance mappings are normalized", async () => {
    const parsed = JSON.parse(
      readFixture("valid-300.backup.json"),
    );
    delete parsed.ledgerData.assets[0].binanceMapping;
    const result = await preflight(
      `${JSON.stringify(parsed, null, 2)}\n`,
    );

    expect(result.hardErrorCount).toBe(0);
    expect(result.candidate?.assets[0]?.binanceMapping).toBeUndefined();
    if (!result.candidate || !result.candidateIdentity) return;
    const normalized = normalizeLedgerDataForRuntime(
      result.candidate,
    );
    expect(normalized.assets[0]?.binanceMapping?.symbol).toBe(
      "BTCUSDT",
    );
    await expect(
      createLedgerDataContentIdentity(normalized),
    ).resolves.toBe(result.candidateIdentity);
  });

  it("keeps valid ETH/BTC duplicate warnings visible beside independent hard errors and leaves ADA splits alone", async () => {
    const serialized = readFixture(
      "preflight-errors-and-duplicates.backup.json",
    );
    const result = await preflight(serialized);

    expect(result.hardErrorCount).toBeGreaterThanOrEqual(2);
    expect(result.retainedDetails).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          kind: "hard-error",
          path: "trades[0].quantity",
        }),
        expect.objectContaining({
          kind: "hard-error",
          code: "BACKUP_TRADE_RAW_TEXT_REQUIRED",
          path: "trades[7].rawText",
        }),
      ]),
    );
    const groups = getSuspiciousDetails(result.retainedDetails);
    expect(groups.map(({ group }) => group.level)).toEqual([
      "high",
      "general",
    ]);
    expect(groups.map(({ group }) => group.tradeIndices)).toEqual([
      [1, 2],
      [3, 4],
    ]);
    expect(
      groups.some(({ group }) =>
        group.tradeIds.some((id) => id.startsWith("ada-split")),
      ),
    ).toBe(false);
    expect(result.candidate).toBeUndefined();
    expect(sha256(serialized)).toBe(result.contentIdentity.sha256);
  });

  it("locks the 50-page, 1000-report and 1001-truncation fixture boundaries", async () => {
    const result = await preflight(
      readFixture("report-1001.backup.json"),
    );

    expect(result.hardErrorCount).toBe(1001);
    expect(result.suspiciousGroupCount).toBe(0);
    expect(result.totalDetailCount).toBe(1001);
    expect(result.visibleDetails).toHaveLength(
      BACKUP_PREFLIGHT_PAGE_DETAIL_LIMIT,
    );
    expect(result.retainedDetails).toHaveLength(
      BACKUP_PREFLIGHT_REPORT_DETAIL_LIMIT,
    );
    expect(result.retainedDetailCount).toBe(
      BACKUP_PREFLIGHT_REPORT_DETAIL_LIMIT,
    );
    expect(result.truncated).toBe(true);
    expect(result.retainedDetails[999]).toEqual(
      expect.objectContaining({
        kind: "hard-error",
        path: "trades[999].quantity",
      }),
    );
  });

  it("returns stable high/general groups and a content-bound group identity", async () => {
    const serialized = readFixture("suspicions-only.backup.json");
    const first = await preflight(serialized, 11);
    const second = await preflight(serialized, 11);

    expect(first.hardErrorCount).toBe(0);
    expect(first.suspiciousGroupCount).toBe(2);
    expect(getSuspiciousDetails(first.retainedDetails)).toEqual([
      expect.objectContaining({
        group: expect.objectContaining({
          level: "high",
          tradeIndices: [0, 1],
        }),
      }),
      expect.objectContaining({
        group: expect.objectContaining({
          level: "general",
          tradeIndices: [2, 3],
        }),
      }),
    ]);
    expect(first.suspiciousGroupIdentity).toBe(
      second.suspiciousGroupIdentity,
    );
    expect(first.candidate?.trades).toHaveLength(6);
  });

  it("makes duplicate trade IDs hard errors and excludes every occurrence from warnings", async () => {
    const parsed = JSON.parse(readFixture("suspicions-only.backup.json"));
    parsed.ledgerData.trades[1].id = parsed.ledgerData.trades[0].id;
    const result = await preflight(`${JSON.stringify(parsed, null, 2)}\n`);

    expect(result.retainedDetails).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          kind: "hard-error",
          code: "LEDGER_DATA_DUPLICATE_IDENTIFIER",
          path: "trades[1].id",
        }),
      ]),
    );
    const groups = getSuspiciousDetails(result.retainedDetails);
    expect(
      groups.some(({ group }) =>
        group.tradeIndices.some((index) => index === 0 || index === 1),
      ),
    ).toBe(false);
  });

  it("excludes a valid occurrence of a duplicate ID even when its peer is structurally invalid", async () => {
    const parsed = JSON.parse(readFixture("suspicions-only.backup.json"));
    const invalidDuplicate = parsed.ledgerData.trades[0];
    const validDuplicate = parsed.ledgerData.trades[1];
    const otherwiseSuspicious = parsed.ledgerData.trades[2];
    invalidDuplicate.quantity = "not-a-decimal";
    validDuplicate.id = invalidDuplicate.id;
    parsed.ledgerData.trades[2] = {
      ...validDuplicate,
      id: otherwiseSuspicious.id,
      rawText: otherwiseSuspicious.rawText,
      createdAt: otherwiseSuspicious.createdAt,
      updatedAt: otherwiseSuspicious.updatedAt,
    };

    const result = await preflight(`${JSON.stringify(parsed, null, 2)}\n`);

    expect(result.retainedDetails).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          kind: "hard-error",
          path: "trades[0].quantity",
        }),
        expect.objectContaining({
          kind: "hard-error",
          code: "LEDGER_DATA_DUPLICATE_IDENTIFIER",
          path: "trades[1].id",
        }),
      ]),
    );
    expect(
      getSuspiciousDetails(result.retainedDetails).some(({ group }) =>
        group.tradeIndices.includes(1),
      ),
    ).toBe(false);
  });

  it("requires missing, non-string and whitespace rawText at exact paths without trimming a legal source line", async () => {
    const parsed = JSON.parse(readFixture("valid-300.backup.json"));
    parsed.ledgerData.trades = parsed.ledgerData.trades.slice(0, 4);
    delete parsed.ledgerData.trades[0].rawText;
    parsed.ledgerData.trades[1].rawText = 42;
    parsed.ledgerData.trades[2].rawText = " \n\t ";
    parsed.ledgerData.trades[3].rawText = "  保留首尾空格的原句  ";

    const result = await preflight(`${JSON.stringify(parsed, null, 2)}\n`);

    expect(
      result.retainedDetails
        .flatMap((detail) =>
          detail.kind === "hard-error" &&
          detail.code === "BACKUP_TRADE_RAW_TEXT_REQUIRED"
            ? [detail.path]
            : [],
        ),
    ).toEqual([
      "trades[0].rawText",
      "trades[1].rawText",
      "trades[2].rawText",
    ]);
    expect(result.candidate).toBeUndefined();
  });

  it("keeps the optional rawText schema for an explicitly generic rescue restore", async () => {
    const parsed = JSON.parse(readFixture("valid-300.backup.json"));
    parsed.ledgerData.trades = parsed.ledgerData.trades.slice(0, 1);
    delete parsed.ledgerData.trades[0].rawText;
    const result = await preflightBackupJson(
      `${JSON.stringify(parsed, null, 2)}\n`,
      {
        todayKey: TODAY,
        selectionGeneration: 1,
        requireHistoricalRawText: false,
      },
    );

    expect(result.hardErrorCount).toBe(0);
    expect(result.candidate?.trades[0].rawText).toBeUndefined();
  });

  it("reports a real JSON parser location or explicitly says the location is unavailable", async () => {
    const result = await preflight("{\n  invalid", 3);
    const detail = result.retainedDetails[0];

    expect(detail).toEqual(
      expect.objectContaining({
        kind: "hard-error",
        code: "BACKUP_BAD_JSON",
        path: "file",
      }),
    );
    if (detail?.kind !== "hard-error") {
      throw new Error("Expected a JSON hard error");
    }
    if (detail.line === undefined) {
      expect(detail.message).toContain("没有提供可靠的行列位置");
      expect(detail.column).toBeUndefined();
    } else {
      expect(detail.line).toBeGreaterThanOrEqual(1);
      expect(detail.column).toBeGreaterThanOrEqual(1);
    }
    expect(result.skippedChecks.map(({ check }) => check)).toEqual([
      "backup-envelope",
      "ledger-structure",
      "resource-policy",
      "import-policy",
      "duplicate-grouping",
    ]);
  });

  it("rejects 8 MiB + 1 by actual UTF-8 bytes before parsing", async () => {
    const oversized = "x".repeat(
      DEFAULT_LEDGER_RESOURCE_LIMITS.fileBytes + 1,
    );
    const result = await preflight(oversized);

    expect(result.contentIdentity.utf8ByteLength).toBe(
      DEFAULT_LEDGER_RESOURCE_LIMITS.fileBytes + 1,
    );
    expect(result.hardErrorCount).toBe(1);
    expect(result.retainedDetails[0]).toEqual(
      expect.objectContaining({
        kind: "hard-error",
        code: "LEDGER_RESOURCE_FILE_TOO_LARGE",
      }),
    );
    expect(result.skippedChecks[0]?.check).toBe("json-parse");
  });

  it("records unsafe downstream layers as skipped instead of calling them passed", async () => {
    const parsed = JSON.parse(readFixture("valid-300.backup.json"));
    parsed.ledgerData.trades = {};
    const result = await preflight(`${JSON.stringify(parsed, null, 2)}\n`);

    expect(result.skippedChecks).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ check: "resource-policy" }),
        expect.objectContaining({ check: "import-policy" }),
        expect.objectContaining({ check: "duplicate-grouping" }),
      ]),
    );
    expect(result.candidate).toBeUndefined();
  });
});

function preflight(serialized: string, selectionGeneration = 1) {
  return preflightBackupJson(serialized, {
    todayKey: TODAY,
    selectionGeneration,
    requireHistoricalRawText: true,
  });
}

function getSuspiciousDetails(
  details: readonly {
    kind: "hard-error" | "suspicious-group";
  }[],
): BackupPreflightSuspiciousDetail[] {
  return details.filter(
    (detail): detail is BackupPreflightSuspiciousDetail =>
      detail.kind === "suspicious-group",
  );
}

function readFixture(name: string): string {
  return readFileSync(
    new URL(`../../test-fixtures/w11-b-import/${name}`, import.meta.url),
    "utf8",
  );
}

function sha256(value: string): string {
  return createHash("sha256").update(value, "utf8").digest("hex");
}
