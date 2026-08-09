import { describe, expect, it } from "vitest";

import type { PriceSnapshot } from "../models";
import { createInitialLedgerData } from "../state/initialLedgerData";
import { createPriceSnapshot } from "../test/fixtures";
import { selectPriceAsOf } from "./priceSelectionService";

const asset = createInitialLedgerData().assets[0];

function apiPrice(
  id: string,
  price: string,
  recordedAt: string,
  fetchedAt = `${recordedAt}T12:00:00Z`,
): PriceSnapshot {
  return {
    ...createPriceSnapshot(id, "BTC", price, recordedAt),
    currency: "USDT",
    source: "api",
    binanceProvenance: {
      provider: "binance",
      symbol: "BTCUSDT",
      sourceQuoteCurrency: "USDT",
      fetchedAt,
    },
  };
}

function manualPrice(
  id: string,
  price: string,
  recordedAt: string,
): PriceSnapshot {
  return {
    ...createPriceSnapshot(id, "BTC", price, recordedAt),
    currency: "USDT",
  };
}

describe("priceSelectionService", () => {
  it("auto mode chooses the newer source and Binance on the same day", () => {
    const manual = manualPrice(
      "manual",
      "69000",
      "2026-07-24",
    );
    const binance = apiPrice("api", "70000", "2026-07-23");
    expect(
      selectPriceAsOf([manual, binance], asset, "2026-07-25", "auto")
        ?.actualSource,
    ).toBe("manual");

    expect(
      selectPriceAsOf(
        [
          { ...manual, recordedAt: "2026-07-25" },
          { ...binance, recordedAt: "2026-07-25" },
        ],
        asset,
        "2026-07-25",
        "auto",
      ),
    ).toEqual(
      expect.objectContaining({
        actualSource: "binance",
        snapshot: expect.objectContaining({ id: "api" }),
      }),
    );
  });

  it("manual mode prefers manual and falls back to auto when absent", () => {
    const manual = manualPrice(
      "manual",
      "68000",
      "2026-07-20",
    );
    const binance = apiPrice("api", "70000", "2026-07-25");
    expect(
      selectPriceAsOf([manual, binance], asset, "2026-07-25", "manual")
        ?.snapshot.id,
    ).toBe("manual");
    expect(
      selectPriceAsOf([binance], asset, "2026-07-25", "manual")?.snapshot.id,
    ).toBe("api");
  });

  it("excludes future, unsupported and legacy provenance-free API candidates", () => {
    const future = apiPrice("future", "90000", "2026-07-26");
    const unsupported = {
      ...createPriceSnapshot("eur", "BTC", "1", "2026-07-25"),
      currency: "EUR",
    };
    const legacyApi = {
      ...createPriceSnapshot("legacy", "BTC", "80000", "2026-07-25"),
      source: "api" as const,
    };
    expect(
      selectPriceAsOf(
        [future, unsupported, legacyApi],
        asset,
        "2026-07-25",
        "auto",
      ),
    ).toBeUndefined();
  });

  it("uses stable later corrections within one source and preserves as-of", () => {
    const first = manualPrice(
      "first",
      "68000",
      "2026-07-25",
    );
    const corrected = {
      ...first,
      id: "corrected",
      price: "69000",
    };
    expect(
      selectPriceAsOf(
        [first, corrected],
        asset,
        "2026-07-25",
        "auto",
      ),
    ).toEqual({
      snapshot: corrected,
      effectiveCurrency: "USDT",
      actualSource: "manual",
      asOf: "2026-07-25",
    });

    const api = apiPrice(
      "api",
      "70000",
      "2026-07-25",
      "2026-07-25T23:59:00+08:00",
    );
    expect(
      selectPriceAsOf([api], asset, "2026-07-25", "auto")?.asOf,
    ).toBe("2026-07-25T23:59:00+08:00");
  });
});
