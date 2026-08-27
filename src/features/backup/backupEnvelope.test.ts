import { describe, expect, it } from "vitest";

import { createInitialLedgerData } from "@/core/state";
import {
  BACKUP_FORMAT_VERSION,
  createBackupEnvelope,
  parseBackupJson,
  serializeBackupEnvelope,
  validateBackupEnvelope,
} from "./backupEnvelope";

const metadata = {
  appVersion: "0.1.0",
  exportedAt: "2026-07-23T12:34:56.789Z",
};

describe("BackupEnvelopeV3 carrying ledger schema V4", () => {
  it("creates a detached, versioned backup envelope", () => {
    const ledger = createInitialLedgerData();
    const result = createBackupEnvelope(ledger, metadata);

    expect(result).toEqual({
      ok: true,
      value: {
        backupFormatVersion: BACKUP_FORMAT_VERSION,
        appVersion: "0.1.0",
        exportedAt: metadata.exportedAt,
        ledgerSchemaVersion: 4,
        ledgerData: ledger,
      },
    });
    if (result.ok) {
      expect(result.value.ledgerData).not.toBe(ledger);
      expect(result.value.ledgerData.assets).not.toBe(ledger.assets);
    }
  });

  it("serializes canonical JSON and parses it back", () => {
    const created = createBackupEnvelope(createInitialLedgerData(), metadata);
    expect(created.ok).toBe(true);
    if (!created.ok) return;

    const serialized = serializeBackupEnvelope(created.value);
    expect(serialized).toMatch(/\n$/);
    expect(Object.keys(JSON.parse(serialized))).toEqual([
      "backupFormatVersion",
      "appVersion",
      "exportedAt",
      "ledgerSchemaVersion",
      "ledgerData",
    ]);
    expect(parseBackupJson(serialized)).toEqual(created);
  });

  it("round-trips ledger schema V4 facts through backup format V3", () => {
    const ledger = createInitialLedgerData();
    ledger.trades = [
      {
        id: "fictional-asset-fee-buy",
        occurredAt: "2026-07-01",
        timePrecision: "day",
        type: "buy",
        assetSymbol: "BTC",
        quantity: "10",
        price: "10",
        totalValue: "100",
        currency: "USDT",
        fee: "1",
        feeCurrency: "BTC",
        rawText: "Fictional V4 same-asset fee example.",
        createdAt: "2026-07-01T00:00:00Z",
        updatedAt: "2026-07-01T00:00:00Z",
      },
    ];

    const created = createBackupEnvelope(ledger, metadata, "2026-07-23");
    expect(created.ok).toBe(true);
    if (!created.ok) return;

    const serialized = serializeBackupEnvelope(created.value);
    expect(parseBackupJson(serialized, "2026-07-23")).toEqual(created);
    expect(JSON.parse(serialized).ledgerData.schemaVersion).toBe(4);
  });

  it("exports only LedgerData facts and strips chart or session-derived fields", () => {
    const ledger = createInitialLedgerData();
    const result = createBackupEnvelope(
      {
        ...ledger,
        positions: [{ assetSymbol: "BTC", marketValue: "70000" }],
        allocationSlices: [{ assetSymbol: "BTC", ratio: "1" }],
        holdingHistory: [{ date: "2026-07-25", totalMarketValue: "70000" }],
        tradeHeatmap: [{ date: "2026-07-25", level: 4 }],
        valuationPriceMode: "manual",
        selectedTradeDate: "2026-07-25",
      },
      metadata,
    );

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const serialized = serializeBackupEnvelope(result.value);
    for (const forbiddenKey of [
      "positions",
      "allocationSlices",
      "holdingHistory",
      "tradeHeatmap",
      "valuationPriceMode",
      "selectedTradeDate",
    ]) {
      expect(serialized).not.toContain(`"${forbiddenKey}"`);
    }
    expect(Object.keys(result.value.ledgerData)).toEqual([
      "schemaVersion",
      "assets",
      "trades",
      "cashEvents",
      "assetTransfers",
      "priceSnapshots",
      "feeRules",
    ]);
  });

  it("rejects future facts before creating an export envelope", () => {
    const ledger = createInitialLedgerData();
    ledger.trades = [
      {
        id: "future-rescue",
        occurredAt: "2099-01-01",
        timePrecision: "day",
        type: "buy",
        assetSymbol: "BTC",
        quantity: "1",
        price: "70000",
        totalValue: "70000",
        currency: "USDT",
        fee: "0",
        feeCurrency: "USDT",
        createdAt: "2026-07-25T00:00:00Z",
        updatedAt: "2026-07-25T00:00:00Z",
      },
    ];

    const result = createBackupEnvelope(ledger, metadata, "2026-07-23");
    expect(result).toEqual({
      ok: false,
      errors: [
        expect.objectContaining({
          code: "LEDGER_IMPORT_FUTURE_FACT",
          path: "trades[0].occurredAt",
        }),
      ],
    });
  });

  it("rejects malformed JSON before it reaches the validator", () => {
    expect(parseBackupJson("{")).toEqual({
      ok: false,
      errors: [expect.objectContaining({ code: "BACKUP_BAD_JSON", path: "file" })],
    });
  });

  it("rejects invalid metadata for the current version pair", () => {
    const ledger = createInitialLedgerData();
    const result = validateBackupEnvelope({
      backupFormatVersion: 3,
      appVersion: "",
      exportedAt: "2026-07-23",
      ledgerSchemaVersion: 4,
      ledgerData: ledger,
    });

    expect(result).toEqual({
      ok: false,
      errors: expect.arrayContaining([
        expect.objectContaining({ code: "BACKUP_INVALID_APP_VERSION" }),
        expect.objectContaining({ code: "BACKUP_INVALID_EXPORTED_AT" }),
      ]),
    });
  });

  it("rejects non-canonical top-level keys, order, and app versions", () => {
    const ledger = createInitialLedgerData();
    const extraKey = validateBackupEnvelope({
      backupFormatVersion: 3,
      appVersion: metadata.appVersion,
      exportedAt: metadata.exportedAt,
      ledgerSchemaVersion: 4,
      ledgerData: ledger,
      unexpected: true,
    });
    const wrongOrder = validateBackupEnvelope({
      appVersion: metadata.appVersion,
      backupFormatVersion: 3,
      exportedAt: metadata.exportedAt,
      ledgerSchemaVersion: 4,
      ledgerData: ledger,
    });
    const invalidAppVersion = validateBackupEnvelope({
      backupFormatVersion: 3,
      appVersion: ` ${"x".repeat(128)}`,
      exportedAt: metadata.exportedAt,
      ledgerSchemaVersion: 4,
      ledgerData: ledger,
    });

    for (const result of [extraKey, wrongOrder]) {
      expect(result).toEqual({
        ok: false,
        errors: expect.arrayContaining([
          expect.objectContaining({
            code: "BACKUP_INVALID_ENVELOPE",
            path: "backup",
          }),
        ]),
      });
    }
    expect(invalidAppVersion).toEqual({
      ok: false,
      errors: expect.arrayContaining([
        expect.objectContaining({ code: "BACKUP_INVALID_APP_VERSION" }),
      ]),
    });
  });

  it.each([
    {
      boundary: "backup format V1",
      backupFormatVersion: 1,
      ledgerSchemaVersion: 4,
      code: "BACKUP_UNSUPPORTED_FORMAT_VERSION",
      path: "backupFormatVersion",
      message: "这是备份格式 V1；当前备份格式为 V3，且不提供迁移",
    },
    {
      boundary: "backup format V2",
      backupFormatVersion: 2,
      ledgerSchemaVersion: 4,
      code: "BACKUP_UNSUPPORTED_FORMAT_VERSION",
      path: "backupFormatVersion",
      message: "这是备份格式 V2；当前备份格式为 V3，且不提供迁移",
    },
    {
      boundary: "ledger schema V1",
      backupFormatVersion: 3,
      ledgerSchemaVersion: 1,
      code: "BACKUP_SCHEMA_VERSION_MISMATCH",
      path: "ledgerSchemaVersion",
      message: "这是账本 schema V1 的备份；当前账本 schema 为 V4，且不提供迁移",
    },
    {
      boundary: "ledger schema V3",
      backupFormatVersion: 3,
      ledgerSchemaVersion: 3,
      code: "BACKUP_SCHEMA_VERSION_MISMATCH",
      path: "ledgerSchemaVersion",
      message: "这是账本 schema V3 的备份；当前账本 schema 为 V4，且不提供迁移",
    },
  ] as const)(
    "rejects retired $boundary before inspecting ledgerData",
    ({
      backupFormatVersion,
      ledgerSchemaVersion,
      code,
      path,
      message,
    }) => {
      const result = validateBackupEnvelope({
        backupFormatVersion,
        appVersion: metadata.appVersion,
        exportedAt: metadata.exportedAt,
        ledgerSchemaVersion,
        ledgerData: { deliberatelyInvalid: true },
      });

      expect(result).toEqual({
        ok: false,
        errors: [
          {
            code,
            path,
            message,
          },
        ],
      });
    },
  );

  it("rejects an unknown future backup format independently from ledger schema", () => {
    const ledger = createInitialLedgerData();
    const result = validateBackupEnvelope({
      backupFormatVersion: 4,
      appVersion: metadata.appVersion,
      exportedAt: metadata.exportedAt,
      ledgerSchemaVersion: 4,
      ledgerData: ledger,
    });

    expect(result).toEqual({
      ok: false,
      errors: [
        {
          code: "BACKUP_UNSUPPORTED_FORMAT_VERSION",
          path: "backupFormatVersion",
          message: "Unsupported backup format version: 4",
        },
      ],
    });
  });

  it("rejects resource-exhausting payloads after structural validation", () => {
    const ledger = createInitialLedgerData();
    ledger.assets[0].name = "x".repeat(129);

    expect(
      validateBackupEnvelope({
        backupFormatVersion: 3,
        appVersion: metadata.appVersion,
        exportedAt: metadata.exportedAt,
        ledgerSchemaVersion: 4,
        ledgerData: ledger,
      }),
    ).toEqual({
      ok: false,
      errors: [
        expect.objectContaining({
          code: "LEDGER_RESOURCE_STRING_LIMIT_EXCEEDED",
          path: "assets[0].name",
          limit: 128,
          actual: 129,
        }),
      ],
    });
  });
});
