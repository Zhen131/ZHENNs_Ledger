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
  "6111e5d69c2d2c455fdd8f91eb8b2014f6271eb4e05d918c55430e07ae22cb32";

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

  it("parses the whole V5 backup fixture into exactly what its text says", () => {
    const serialized = readFileSync(GOLDEN_V5_BACKUP_URL, "utf8");

    const result = parseBackupJson(serialized, "2026-09-06");

    // Every value below is transcribed by hand from the fixture's JSON text,
    // never taken from a parse. Comparing the whole envelope is what catches a
    // parser that alters content on the way in; a few field assertions cannot.
    expect(result).toEqual({
      ok: true,
      value: GOLDEN_V5_BACKUP_TEXT_TRANSCRIPT,
    });
  });

  it("keeps a high-precision decimal canary in the V5 backup fixture", () => {
    const serialized = readFileSync(GOLDEN_V5_BACKUP_URL, "utf8");
    const result = parseBackupJson(serialized, "2026-09-06");
    if (!result.ok) throw new Error("V5 golden backup must validate");

    const price = result.value.ledgerData.priceSnapshots[0]?.price;

    // The deepest decimal in the V4 fixtures carries 18 fraction digits. This
    // canary must not be shallower, or the fixture stops proving that a
    // decimal survives a round trip without being rounded through a float.
    expect(price).toBe("4.000000000000000003");
    expect(price?.split(".")[1]?.length).toBeGreaterThanOrEqual(18);
    expect(serialized).toContain('"price": "4.000000000000000003"');
  });
});

const GOLDEN_V5_BACKUP_TEXT_TRANSCRIPT = {
  backupFormatVersion: 3,
  appVersion: "0.1.0-golden-v5",
  exportedAt: "2026-09-06T12:00:00.000Z",
  ledgerSchemaVersion: 5,
  ledgerData: {
    schemaVersion: 5,
    assets: [
      {
        id: "asset-fictional-time-zone",
        symbol: "FICTZ",
        name: "Fictional Time Zone Asset",
        quoteCurrency: "USDT",
        binanceMapping: null,
        createdAt: "2026-09-01T00:00:00Z",
        updatedAt: "2026-09-01T00:00:00Z",
      },
    ],
    trades: [
      {
        id: "trade-fictional-time-zone",
        occurredAt: "2026-09-01T09:15:00+08:00",
        occurredTimeZone: "Asia/Shanghai",
        timePrecision: "second",
        type: "buy",
        assetSymbol: "FICTZ",
        quantity: "2",
        price: "3",
        totalValue: "6",
        currency: "USDT",
        fee: "0",
        feeCurrency: "USDT",
        platform: "Fictional Venue",
        note: "Fictional V5 trade with a recorded location.",
        rawText: "Fictional golden fixture trade.",
        createdAt: "2026-09-01T09:15:00+08:00",
        updatedAt: "2026-09-01T09:15:00+08:00",
      },
    ],
    cashEvents: [
      {
        id: "cash-fictional-without-time-zone",
        occurredAt: "2026-09-02",
        timePrecision: "day",
        type: "deposit",
        currency: "USDT",
        amount: "20",
        note: "Fictional V5 cash fact without a recorded location.",
        createdAt: "2026-09-02T00:00:00Z",
        updatedAt: "2026-09-02T00:00:00Z",
      },
    ],
    assetTransfers: [
      {
        id: "transfer-fictional-time-zone",
        occurredAt: "2026-09-03T10:30:00+02:00",
        occurredTimeZone: "Europe/Budapest",
        timePrecision: "second",
        assetSymbol: "FICTZ",
        quantity: "1",
        category: "internal",
        reason: "internal-move",
        fromLocation: "exchange",
        toLocation: "cold-wallet",
        note: "Fictional V5 transfer with a recorded location.",
        createdAt: "2026-09-03T10:30:00+02:00",
        updatedAt: "2026-09-03T10:30:00+02:00",
      },
    ],
    priceSnapshots: [
      {
        id: "price-fictional-time-zone",
        assetSymbol: "FICTZ",
        price: "4.000000000000000003",
        currency: "USDT",
        recordedAt: "2026-09-04T11:00:00Z",
        occurredTimeZone: "UTC",
        source: "manual",
        note: "Fictional V5 price with a recorded location.",
        createdAt: "2026-09-04T11:00:00Z",
        updatedAt: "2026-09-04T11:00:00Z",
      },
    ],
    feeRules: [],
  },
};
