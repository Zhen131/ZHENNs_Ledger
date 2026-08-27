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

describe("BackupEnvelopeV4", () => {
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

  it("round-trips same-asset fees through the unchanged V4 envelope", () => {
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

  it("rejects invalid metadata and mismatched schema versions", () => {
    const ledger = createInitialLedgerData();
    const result = validateBackupEnvelope({
      backupFormatVersion: 4,
      appVersion: "",
      exportedAt: "2026-07-23",
      ledgerSchemaVersion: 1,
      ledgerData: ledger,
    });

    expect(result).toEqual({
      ok: false,
      errors: expect.arrayContaining([
        expect.objectContaining({ code: "BACKUP_INVALID_APP_VERSION" }),
        expect.objectContaining({ code: "BACKUP_INVALID_EXPORTED_AT" }),
        expect.objectContaining({ code: "BACKUP_SCHEMA_VERSION_MISMATCH" }),
      ]),
    });
    if (!result.ok) {
      expect(
        result.errors.filter(
          (error) => error.code === "BACKUP_SCHEMA_VERSION_MISMATCH",
        ),
      ).toHaveLength(1);
    }
  });

  it("rejects non-canonical top-level keys, order, and app versions", () => {
    const ledger = createInitialLedgerData();
    const extraKey = validateBackupEnvelope({
      backupFormatVersion: 4,
      appVersion: metadata.appVersion,
      exportedAt: metadata.exportedAt,
      ledgerSchemaVersion: 4,
      ledgerData: ledger,
      unexpected: true,
    });
    const wrongOrder = validateBackupEnvelope({
      appVersion: metadata.appVersion,
      backupFormatVersion: 4,
      exportedAt: metadata.exportedAt,
      ledgerSchemaVersion: 4,
      ledgerData: ledger,
    });
    const invalidAppVersion = validateBackupEnvelope({
      backupFormatVersion: 4,
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
    [2, "这是 V2 备份；当前 V4 不兼容且不提供迁移"],
    [3, "这是 V3 备份；当前 V4 不兼容且不提供迁移"],
  ] as const)(
    "rejects a V%i backup at the version boundary without inspecting ledgerData",
    (backupFormatVersion, message) => {
      const result = validateBackupEnvelope({
        backupFormatVersion,
        appVersion: metadata.appVersion,
        exportedAt: metadata.exportedAt,
        ledgerSchemaVersion: backupFormatVersion,
        ledgerData: { deliberatelyInvalid: true },
      });

      expect(result).toEqual({
        ok: false,
        errors: [
          {
            code: "BACKUP_UNSUPPORTED_FORMAT_VERSION",
            path: "backupFormatVersion",
            message,
          },
        ],
      });
    },
  );

  it("rejects a V1 backup without returning a V4 value", () => {
    const ledger = createInitialLedgerData();
    const result = validateBackupEnvelope({
      backupFormatVersion: 1,
      appVersion: metadata.appVersion,
      exportedAt: metadata.exportedAt,
      ledgerSchemaVersion: 1,
      ledgerData: { ...ledger, schemaVersion: 1 },
    });

    expect(result).toEqual({
      ok: false,
      errors: expect.arrayContaining([
        expect.objectContaining({
          code: "BACKUP_UNSUPPORTED_FORMAT_VERSION",
          path: "backupFormatVersion",
        }),
        expect.objectContaining({
          code: "BACKUP_SCHEMA_VERSION_MISMATCH",
          path: "ledgerSchemaVersion",
        }),
      ]),
    });
  });

  it("rejects resource-exhausting payloads after structural validation", () => {
    const ledger = createInitialLedgerData();
    ledger.assets[0].name = "x".repeat(129);

    expect(
      validateBackupEnvelope({
        backupFormatVersion: 4,
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
