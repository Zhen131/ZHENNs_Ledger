import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

import {
  parseBackupJson,
  serializeBackupEnvelope,
} from "./backupEnvelope";

const GOLDEN_BACKUP_URL = new URL(
  "../../../test-fixtures/golden/golden-backup-format-v3-ledger-schema-v4.json",
  import.meta.url,
);
// This digest freezes these bytes; future versions must add another fixture.
const GOLDEN_BACKUP_SHA256 =
  "bb1403b1a8b198ee53ab904dd03ed26dc0ec6f8976ff2f5faeb1fbdf3eeeb710";

describe("versioned golden backup fixture", () => {
  it("freezes the exact backup format V3 and ledger schema V4 bytes", () => {
    const serialized = readFileSync(GOLDEN_BACKUP_URL, "utf8");

    expect(createHash("sha256").update(serialized).digest("hex")).toBe(
      GOLDEN_BACKUP_SHA256,
    );
  });

  it("parses as canonical backup format V3 carrying ledger schema V4", () => {
    const serialized = readFileSync(GOLDEN_BACKUP_URL, "utf8");
    const result = parseBackupJson(serialized, "2026-08-02");

    expect(result.ok).toBe(true);
    if (!result.ok) return;

    expect(result.value.backupFormatVersion).toBe(3);
    expect(result.value.ledgerSchemaVersion).toBe(4);
    expect(result.value.ledgerData.schemaVersion).toBe(4);
    expect(result.value.ledgerData).toEqual(
      expect.objectContaining({
        assets: [expect.objectContaining({ symbol: "FICTA" })],
        trades: [],
        cashEvents: [expect.objectContaining({ type: "deposit" })],
        assetTransfers: [
          expect.objectContaining({
            category: "external-in",
            quantity: "2.500000000000000001",
          }),
        ],
        priceSnapshots: [expect.objectContaining({ source: "manual" })],
        feeRules: [expect.objectContaining({ type: "fixed" })],
      }),
    );
    expect(serializeBackupEnvelope(result.value)).toBe(serialized);
  });
});
