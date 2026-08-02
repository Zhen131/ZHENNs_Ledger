import { describe, expect, it } from "vitest";

import { createInitialLedgerData } from "../state/initialLedgerData";
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

describe("BackupEnvelopeV1", () => {
  it("creates a detached, versioned backup envelope", () => {
    const ledger = createInitialLedgerData();
    const result = createBackupEnvelope(ledger, metadata);

    expect(result).toEqual({
      ok: true,
      value: {
        backupFormatVersion: BACKUP_FORMAT_VERSION,
        appVersion: "0.1.0",
        exportedAt: metadata.exportedAt,
        ledgerSchemaVersion: 1,
        ledgerData: ledger,
      },
    });
    if (result.ok) {
      expect(result.value.ledgerData).not.toBe(ledger);
      expect(result.value.ledgerData.assets).not.toBe(ledger.assets);
    }
  });

  it("serializes canonical JSON and parses it back", () => {
    const ledger = createInitialLedgerData();
    const legacyRawText = "\u4eca\u5929\u4e70\u4e86 0.5 \u4e2a\u6bd4\u7279\u5e01";
    ledger.trades = [
      {
        id: "legacy-unicode-raw-text",
        occurredAt: "2026-07-23",
        timePrecision: "day",
        type: "buy",
        assetSymbol: "BTC",
        quantity: "0.5",
        price: "70000",
        totalValue: "35000",
        currency: "USD",
        fee: "0",
        feeCurrency: "USD",
        rawText: legacyRawText,
        createdAt: "2026-07-23T12:34:56.789Z",
        updatedAt: "2026-07-23T12:34:56.789Z",
      },
    ];
    const created = createBackupEnvelope(ledger, metadata);
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
    const parsed = parseBackupJson(serialized);
    expect(parsed).toEqual(created);
    expect(parsed.ok && parsed.value.ledgerData.trades[0]?.rawText).toBe(
      legacyRawText,
    );
    if (parsed.ok) {
      expect(serializeBackupEnvelope(parsed.value)).toBe(serialized);
    }
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
      "priceSnapshots",
      "feeRules",
    ]);
  });

  it("allows a complete rescue export to retain legacy future facts", () => {
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
        currency: "USD",
        fee: "0",
        feeCurrency: "USD",
        createdAt: "2026-07-25T00:00:00Z",
        updatedAt: "2026-07-25T00:00:00Z",
      },
    ];

    const result = createBackupEnvelope(ledger, metadata);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.ledgerData.trades).toEqual(ledger.trades);
    expect(serializeBackupEnvelope(result.value)).toContain(
      '"occurredAt": "2099-01-01"',
    );
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
      backupFormatVersion: 1,
      appVersion: "",
      exportedAt: "2026-07-23",
      ledgerSchemaVersion: 2,
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

  it("rejects resource-exhausting payloads after structural validation", () => {
    const ledger = createInitialLedgerData();
    ledger.assets[0].name = "x".repeat(129);

    expect(
      validateBackupEnvelope({
        backupFormatVersion: 1,
        appVersion: metadata.appVersion,
        exportedAt: metadata.exportedAt,
        ledgerSchemaVersion: 1,
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
