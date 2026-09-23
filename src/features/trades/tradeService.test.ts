import { describe, expect, it } from "vitest";
import { createInitialLedgerData } from "@/core/state";
import { TRADE_VALIDATION_ERROR_CODES } from "@/core/validation";
import { createValidatedTrade } from "./tradeService";
import {
  TIMESTAMP,
  validBuy,
  createDependencies,
} from "./tradeService.testHelpers";

describe("createValidatedTrade success", () => {
  it("creates a complete trade from validated fields and system dependencies", () => {
    const input = {
      ...validBuy,
      note: "manual entry",
      rawText: "buy 0.001 BTC",
      feeRuleId: "fee-rule-1",
      id: "forged-id",
      createdAt: "2000-01-01T00:00:00.000Z",
      updatedAt: "2000-01-01T00:00:00.000Z",
      quantitySortKey: "forged-quantity-key",
      totalValueSortKey: "forged-value-key",
    };
    const ledgerData = createInitialLedgerData();
    const dependencies = createDependencies(["trade-new"]);

    const result = createValidatedTrade(input, ledgerData, dependencies);

    expect(result.ok).toBe(true);
    if (!result.ok) {
      return;
    }

    expect(result.trade).toEqual({
      ...validBuy,
      fee: "0",
      note: "manual entry",
      rawText: "buy 0.001 BTC",
      feeRuleId: "fee-rule-1",
      id: "trade-new",
      feeCurrency: "USDT",
      createdAt: TIMESTAMP,
      updatedAt: TIMESTAMP,
    });
    expect(result.trade.createdAt).toBe(result.trade.updatedAt);
    expect(result.trade).not.toHaveProperty("quantitySortKey");
    expect(result.trade).not.toHaveProperty("totalValueSortKey");
    expect(dependencies.generateId).toHaveBeenCalledTimes(1);
    expect(dependencies.now).toHaveBeenCalledTimes(1);
    expect(ledgerData.trades).toHaveLength(0);
  });

  it("rejects a non-zero fee in a different currency", () => {
    const result = createValidatedTrade(
      { ...validBuy, fee: "1", feeCurrency: "CNY" },
      createInitialLedgerData(),
      createDependencies(["trade-new"]),
    );

    expect(result.ok).toBe(false);
    if (!result.ok && result.kind === "validation") {
      expect(result.errors).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            code: TRADE_VALIDATION_ERROR_CODES.FEE_CURRENCY_MISMATCH,
            field: "feeCurrency",
          }),
        ]),
      );
    }
  });

  it("preserves a non-zero fee denominated in an existing local asset", () => {
    const result = createValidatedTrade(
      { ...validBuy, fee: "0.0001", feeCurrency: "BTC" },
      createInitialLedgerData(),
      createDependencies(["trade-new"]),
    );

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.trade.fee).toBe("0.0001");
      expect(result.trade.feeCurrency).toBe("BTC");
    }
  });

  it("normalizes every new zero-fee fact to the USDT trade currency", () => {
    const result = createValidatedTrade(
      { ...validBuy, fee: "0", feeCurrency: "CNY" },
      createInitialLedgerData(),
      createDependencies(["trade-new"]),
    );

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.trade.feeCurrency).toBe("USDT");
    }
  });

  it("records a canonical rawText snapshot for structured trades without an external source line", () => {
    const result = createValidatedTrade(
      {
        ...validBuy,
        fee: "5",
        platform: "OKX",
        note: "structured form",
      },
      createInitialLedgerData(),
      createDependencies(["trade-new"]),
    );

    expect(result.ok).toBe(true);
    if (!result.ok) return;

    expect(result.trade.rawText).toBe(
      'Structured ledger entry: {"occurredAt":"2026-07-14","timePrecision":"day","type":"buy","assetSymbol":"BTC","quantity":"0.001","price":"70000","totalValue":"70","currency":"USDT","fee":"5","feeCurrency":"USDT","platform":"OKX","note":"structured form"}',
    );
  });

  it("rejects USD trades under the V4 contract", () => {
    const legacyLedger = createInitialLedgerData();
    const result = createValidatedTrade(
      { ...validBuy, currency: "USD" },
      legacyLedger,
      createDependencies(["unused"]),
    );

    expect(result.ok).toBe(false);
    if (!result.ok && result.kind === "validation") {
      expect(result.errors).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            code: TRADE_VALIDATION_ERROR_CODES.NEW_FACT_REQUIRES_USDT,
            field: "currency",
          }),
        ]),
      );
    }
  });

  it("uses production ID and time dependencies when none are provided", () => {
    const result = createValidatedTrade(validBuy, createInitialLedgerData());

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.trade.id).toMatch(
        /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/,
      );
      expect(Number.isNaN(Date.parse(result.trade.createdAt))).toBe(false);
      expect(result.trade.updatedAt).toBe(result.trade.createdAt);
    }
  });
});
