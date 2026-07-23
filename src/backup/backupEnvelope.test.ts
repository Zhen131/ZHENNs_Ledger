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

  it("rejects malformed JSON before it reaches the validator", () => {
    expect(parseBackupJson("{")).toEqual({
      ok: false,
      errors: [
        expect.objectContaining({ code: "BACKUP_JSON_INVALID", path: "file" }),
      ],
    });
  });

  it("rejects invalid metadata and mismatched schema versions", () => {
    const ledger = createInitialLedgerData();
    expect(
      validateBackupEnvelope({
        backupFormatVersion: 1,
        appVersion: "",
        exportedAt: "2026-07-23",
        ledgerSchemaVersion: 2,
        ledgerData: ledger,
      }),
    ).toEqual({
      ok: false,
      errors: expect.arrayContaining([
        expect.objectContaining({ code: "BACKUP_INVALID_APP_VERSION" }),
        expect.objectContaining({ code: "BACKUP_INVALID_EXPORTED_AT" }),
        expect.objectContaining({ code: "BACKUP_UNSUPPORTED_LEDGER_SCHEMA" }),
        expect.objectContaining({ code: "BACKUP_SCHEMA_VERSION_MISMATCH" }),
      ]),
    });
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
        }),
      ],
    });
  });
});
