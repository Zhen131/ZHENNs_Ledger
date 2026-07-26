import { describe, expect, it } from "vitest";

import { validateBackupEnvelope } from "../backup/backupEnvelope";
import type { PriceSnapshot } from "../models";
import { createInitialLedgerData } from "../state/initialLedgerData";
import {
  createPriceSnapshot,
  createSimpleTrade,
} from "../test/fixtures";
import { validateLedgerData } from "../validators/ledgerDataValidator";
import {
  collectLedgerCompatibilityWarnings,
  normalizeLedgerDataForRuntime,
  partitionLedgerFactsForToday,
} from "./ledgerFactPolicy";
import { validateLedgerImportPolicy } from "./ledgerImportPolicy";

const TODAY = "2026-07-25";
const TIMESTAMP = "2026-07-25T10:00:00+08:00";

function createApiSnapshot(
  id: string,
  recordedAt: string,
  fetchedAt = TIMESTAMP,
): PriceSnapshot {
  return {
    ...createPriceSnapshot(id, "BTC", "70000", recordedAt),
    source: "api",
    binanceProvenance: {
      provider: "binance",
      symbol: "BTCUSDT",
      sourceQuoteCurrency: "USDT",
      fetchedAt,
    },
  };
}

describe("ledger fact compatibility policy", () => {
  it("partitions future facts without moving offset dates", () => {
    const ledgerData = createInitialLedgerData();
    ledgerData.trades = [
      createSimpleTrade(
        "active",
        "buy",
        "BTC",
        "1",
        "2026-07-25T23:30:00-10:00",
      ),
      createSimpleTrade("future", "buy", "BTC", "1", "2026-07-26"),
    ];
    ledgerData.priceSnapshots = [
      createPriceSnapshot("active-price", "BTC", "70000", TODAY),
      createPriceSnapshot("future-price", "BTC", "71000", "2026-07-26"),
    ];

    const result = partitionLedgerFactsForToday(ledgerData, TODAY);
    expect(result.activeTrades.map((trade) => trade.id)).toEqual(["active"]);
    expect(result.futureTrades.map((trade) => trade.id)).toEqual(["future"]);
    expect(result.activePriceSnapshots.map((price) => price.id)).toEqual([
      "active-price",
    ]);
    expect(result.futurePriceSnapshots.map((price) => price.id)).toEqual([
      "future-price",
    ]);
  });

  it("normalizes only undefined built-in mappings and preserves explicit null", () => {
    const ledgerData = createInitialLedgerData();
    ledgerData.assets[0] = {
      ...ledgerData.assets[0],
      binanceMapping: undefined,
    };
    ledgerData.assets[1] = {
      ...ledgerData.assets[1],
      binanceMapping: null,
    };

    const normalized = normalizeLedgerDataForRuntime(ledgerData);
    expect(normalized.assets[0].binanceMapping?.symbol).toBe("BTCUSDT");
    expect(normalized.assets[1].binanceMapping).toBeNull();
    expect(ledgerData.assets[0].binanceMapping).toBeUndefined();
  });

  it("warns for legacy rescue cases but keeps structural validation readable", () => {
    const ledgerData = createInitialLedgerData();
    ledgerData.priceSnapshots = [
      {
        ...createPriceSnapshot("legacy-api", "BTC", "70000", TODAY),
        source: "api",
      },
      createApiSnapshot("api-1", TODAY),
      createApiSnapshot("api-2", TODAY, "2026-07-25T11:00:00+08:00"),
    ];

    expect(validateLedgerData(ledgerData).ok).toBe(true);
    expect(
      collectLedgerCompatibilityWarnings(ledgerData, TODAY).map(
        (warning) => warning.code,
      ),
    ).toEqual(
      expect.arrayContaining([
        "LEDGER_LEGACY_API_PRICE_WITHOUT_PROVENANCE",
        "LEDGER_DUPLICATE_DAILY_BINANCE_PRICE",
      ]),
    );
  });
});

describe("strict import policy", () => {
  it("returns precise paths for future facts and unsupported valuation currencies", () => {
    const ledgerData = createInitialLedgerData();
    ledgerData.assets[0] = {
      ...ledgerData.assets[0],
      quoteCurrency: "EUR",
    };
    ledgerData.trades = [
      {
        ...createSimpleTrade("future", "buy", "BTC", "1", "2026-07-26"),
        currency: "EUR",
        feeCurrency: "BNB",
      },
    ];
    ledgerData.priceSnapshots = [
      {
        ...createPriceSnapshot("future-price", "BTC", "70000", "2026-07-26"),
        currency: "EUR",
      },
    ];

    const result = validateLedgerImportPolicy(ledgerData, TODAY);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.errors.map((error) => error.path)).toEqual(
        expect.arrayContaining([
          "assets[0].quoteCurrency",
          "trades[0].occurredAt",
          "trades[0].currency",
          "priceSnapshots[0].recordedAt",
          "priceSnapshots[0].currency",
        ]),
      );
      expect(result.errors.some((error) => error.path.includes("feeCurrency"))).toBe(
        false,
      );
    }
  });

  it("rejects imported API prices without provenance and daily duplicates", () => {
    const ledgerData = createInitialLedgerData();
    ledgerData.priceSnapshots = [
      {
        ...createPriceSnapshot("legacy-api", "BTC", "69000", TODAY),
        source: "api",
      },
      createApiSnapshot("api-1", TODAY),
      createApiSnapshot("api-2", TODAY, "2026-07-25T11:00:00+08:00"),
    ];

    const result = validateLedgerImportPolicy(ledgerData, TODAY);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.errors).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            code: "LEDGER_IMPORT_API_PRICE_PROVENANCE_REQUIRED",
            path: "priceSnapshots[0].binanceProvenance",
          }),
          expect.objectContaining({
            code: "LEDGER_IMPORT_DUPLICATE_DAILY_BINANCE_PRICE",
            path: "priceSnapshots[2]",
          }),
        ]),
      );
    }
  });

  it("preserves mappings and provenance through validation and backup import", () => {
    const ledgerData = createInitialLedgerData();
    ledgerData.priceSnapshots = [createApiSnapshot("api", TODAY)];

    const validated = validateLedgerData(ledgerData);
    expect(validated.ok).toBe(true);
    if (!validated.ok) {
      return;
    }
    expect(validated.value.assets[0].binanceMapping?.symbol).toBe("BTCUSDT");
    expect(
      validated.value.priceSnapshots[0].binanceProvenance?.fetchedAt,
    ).toBe(TIMESTAMP);

    const backup = validateBackupEnvelope(
      {
        backupFormatVersion: 1,
        appVersion: "0.1.0",
        exportedAt: "2026-07-25T12:00:00Z",
        ledgerSchemaVersion: 1,
        ledgerData,
      },
      TODAY,
    );
    expect(backup.ok).toBe(true);
    if (backup.ok) {
      expect(backup.value.ledgerData.schemaVersion).toBe(1);
      expect(
        backup.value.ledgerData.priceSnapshots[0].binanceProvenance?.symbol,
      ).toBe("BTCUSDT");
    }
  });
});
