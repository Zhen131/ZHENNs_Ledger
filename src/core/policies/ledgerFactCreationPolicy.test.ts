import { describe, expect, it } from "vitest";

import type { LedgerData, TradeDraft } from "@/core/models";
import { createInitialLedgerData } from "@/core/state";
import { createValidatedPriceSnapshot } from "@/services/priceSnapshotService";
import { createValidatedTrade } from "@/services/tradeService";

const TODAY = "2026-07-25";
const NOW = "2026-07-25T12:00:00Z";

const dependencies = {
  generateId: () => "new-id",
  now: () => NOW,
  todayKey: () => TODAY,
};

const tradeDraft: TradeDraft = {
  occurredAt: TODAY,
  timePrecision: "day",
  type: "buy",
  assetSymbol: "BTC",
  quantity: "1",
  price: "10",
  totalValue: "10",
  currency: "USDT",
  fee: "0",
  feeCurrency: "BNB",
};

describe("new ledger fact policy", () => {
  it("rejects future trades before generating an id", () => {
    const result = createValidatedTrade(
      { ...tradeDraft, occurredAt: "2026-07-26" },
      createInitialLedgerData(),
      dependencies,
    );

    expect(result.ok).toBe(false);
    if (!result.ok && result.kind === "validation") {
      expect(result.errors).toContainEqual(
        expect.objectContaining({
          code: "FUTURE_FACT",
          field: "occurredAt",
        }),
      );
    }
  });

  it("rejects unsupported valuation facts before normalizing fee currency", () => {
    const ledgerData: LedgerData = createInitialLedgerData();
    ledgerData.assets[0] = {
      ...ledgerData.assets[0],
      quoteCurrency: "EUR",
    };

    const result = createValidatedTrade(
      { ...tradeDraft, currency: "EUR" },
      ledgerData,
      dependencies,
    );
    expect(result.ok).toBe(false);
    if (!result.ok && result.kind === "validation") {
      expect(result.errors).toContainEqual(
        expect.objectContaining({
          code: "UNSUPPORTED_VALUATION_CURRENCY",
          field: "currency",
        }),
      );
      expect(result.errors.some((error) => error.field === "feeCurrency")).toBe(
        false,
      );
    }
  });

  it("rejects future manual prices and API prices without provenance", () => {
    const ledgerData = createInitialLedgerData();
    const future = createValidatedPriceSnapshot(
      {
        assetSymbol: "BTC",
        price: "70000",
        currency: "USDT",
        recordedAt: "2026-07-26",
        source: "manual",
      },
      ledgerData,
      dependencies,
    );
    expect(future.ok).toBe(false);
    if (!future.ok && future.kind === "validation") {
      expect(future.errors).toContainEqual(
        expect.objectContaining({
          code: "PRICE_SNAPSHOT_FUTURE_FACT",
          field: "recordedAt",
        }),
      );
    }

    const api = createValidatedPriceSnapshot(
      {
        assetSymbol: "BTC",
        price: "70000",
        currency: "USDT",
        recordedAt: TODAY,
        source: "api",
      },
      ledgerData,
      dependencies,
    );
    expect(api.ok).toBe(false);
    if (!api.ok && api.kind === "validation") {
      expect(api.errors).toContainEqual(
        expect.objectContaining({
          code: "PRICE_SNAPSHOT_BINANCE_PROVENANCE_REQUIRED",
          field: "binanceProvenance",
        }),
      );
    }
  });

  it("accepts a sourced Binance price with the response date", () => {
    const result = createValidatedPriceSnapshot(
      {
        assetSymbol: "BTC",
        price: "70000",
        currency: "USDT",
        recordedAt: TODAY,
        source: "api",
        binanceProvenance: {
          provider: "binance",
          symbol: "BTCUSDT",
          sourceQuoteCurrency: "USDT",
          fetchedAt: NOW,
        },
      },
      createInitialLedgerData(),
      dependencies,
    );
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.priceSnapshot.binanceProvenance?.symbol).toBe("BTCUSDT");
    }
  });
});
