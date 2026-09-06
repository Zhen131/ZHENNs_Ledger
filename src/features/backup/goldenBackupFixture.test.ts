import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

import {
  parseBackupJson,
} from "./backupEnvelope";

const GOLDEN_BACKUP_URL = new URL(
  "../../../test-fixtures/golden/golden-backup-format-v3-ledger-schema-v4.json",
  import.meta.url,
);
// This digest freezes these bytes; future versions must add another fixture.
const GOLDEN_BACKUP_SHA256 =
  "bb1403b1a8b198ee53ab904dd03ed26dc0ec6f8976ff2f5faeb1fbdf3eeeb710";
const GOLDEN_V5_BACKUP_URL = new URL(
  "../../../test-fixtures/golden/golden-backup-format-v3-ledger-schema-v5-time-zone.json",
  import.meta.url,
);
const GOLDEN_V5_BACKUP_SHA256 =
  "8b13ef69be9f6482db8341813e68f63dc764247181e72675b73df7366fb64baf";

describe("versioned golden backup fixture", () => {
  it("freezes the exact backup format V3 and ledger schema V4 bytes", () => {
    const serialized = readFileSync(GOLDEN_BACKUP_URL, "utf8");

    expect(createHash("sha256").update(serialized).digest("hex")).toBe(
      GOLDEN_BACKUP_SHA256,
    );
  });

  it("rejects the frozen V4 backup without rewriting its bytes", () => {
    const serialized = readFileSync(GOLDEN_BACKUP_URL, "utf8");
    const result = parseBackupJson(serialized, "2026-08-02");

    expect(result).toEqual({
      ok: false,
      errors: [
        expect.objectContaining({
          code: "BACKUP_SCHEMA_VERSION_MISMATCH",
          path: "ledgerSchemaVersion",
          message: "这是账本 schema V4 的备份；当前账本 schema 为 V5，且不提供迁移",
        }),
      ],
    });
    expect(readFileSync(GOLDEN_BACKUP_URL, "utf8")).toBe(serialized);
  });

  it("accepts the immutable V5 backup fixture with optional fact time zones", () => {
    const serialized = readFileSync(GOLDEN_V5_BACKUP_URL, "utf8");

    expect(createHash("sha256").update(serialized).digest("hex")).toBe(
      GOLDEN_V5_BACKUP_SHA256,
    );
    const result = parseBackupJson(serialized, "2026-09-06");
    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error("V5 golden backup must validate");
    expect(result.value.ledgerSchemaVersion).toBe(5);
    expect(result.value.ledgerData.trades[0]?.occurredTimeZone).toBe(
      "Asia/Shanghai",
    );
    expect(result.value.ledgerData.cashEvents[0]).not.toHaveProperty(
      "occurredTimeZone",
    );
    expect(result.value.ledgerData.assetTransfers[0]?.occurredTimeZone).toBe(
      "Europe/Budapest",
    );
    expect(result.value.ledgerData.priceSnapshots[0]?.occurredTimeZone).toBe(
      "UTC",
    );
    expect(readFileSync(GOLDEN_V5_BACKUP_URL, "utf8")).toBe(serialized);
  });
});
