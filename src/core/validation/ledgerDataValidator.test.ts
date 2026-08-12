import { describe, expect, it } from "vitest";

import type { LedgerData } from "@/core/models";
import { createInitialLedgerData } from "@/core/state";
import {
  createPriceSnapshot,
  sampleTrades,
} from "@/test-support";
import {
  collectValidLedgerTradeProjections,
  LEDGER_DATA_VALIDATION_ERROR_CODES,
  validateLedgerData,
} from "./ledgerDataValidator";

function createCompleteLedger(): LedgerData {
  const initialLedger = createInitialLedgerData();
  initialLedger.assets = initialLedger.assets.map((asset) => ({
    ...asset,
    quoteCurrency: "USD",
  }));

  return {
    ...initialLedger,
    trades: structuredClone(sampleTrades),
    priceSnapshots: [
      createPriceSnapshot("price-btc", "BTC", "70000", "2026-07-16"),
    ],
    feeRules: [
      {
        id: "fee-rule-1",
        name: "Default",
        platform: "Manual",
        assetSymbol: "BTC",
        status: "active",
        type: "percentage",
        rate: "0.001",
        currency: "USDT",
        createdAt: "2026-07-16T00:00:00Z",
        updatedAt: "2026-07-16T00:00:00Z",
      },
    ],
  };
}

function expectError(
  input: unknown,
  code: string,
  path: string,
) {
  const result = validateLedgerData(input);

  expect(result.ok).toBe(false);
  if (!result.ok) {
    expect(result.errors).toEqual(
      expect.arrayContaining([expect.objectContaining({ code, path })]),
    );
  }
}

describe("validateLedgerData", () => {
  it("accepts a complete ledger and returns a detached sanitized value", () => {
    const input = createCompleteLedger();
    const snapshot = structuredClone(input);

    const result = validateLedgerData(input);

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value).toEqual(snapshot);
      expect(result.value).not.toBe(input);
      expect(result.value.assets).not.toBe(input.assets);
      expect(result.value.trades).not.toBe(input.trades);
    }
    expect(input).toEqual(snapshot);
  });

  it("accepts the empty production initial ledger", () => {
    expect(validateLedgerData(createInitialLedgerData()).ok).toBe(true);
  });

  it("preserves a legacy USD trade with a non-zero foreign fee", () => {
    const input = createCompleteLedger();
    input.trades[0] = {
      ...input.trades[0],
      fee: "1",
      feeCurrency: "CNY",
    };

    const result = validateLedgerData(input);

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.trades[0]).toEqual(input.trades[0]);
    }
  });

  it("rejects non-object roots and unsupported schema versions", () => {
    expectError(
      "invalid",
      LEDGER_DATA_VALIDATION_ERROR_CODES.INVALID_ROOT,
      "ledgerData",
    );
    expectError(
      { ...createInitialLedgerData(), schemaVersion: 1 },
      LEDGER_DATA_VALIDATION_ERROR_CODES.UNSUPPORTED_SCHEMA_VERSION,
      "schemaVersion",
    );
    expectError(
      { ...createInitialLedgerData(), schemaVersion: 3 },
      LEDGER_DATA_VALIDATION_ERROR_CODES.UNSUPPORTED_SCHEMA_VERSION,
      "schemaVersion",
    );
  });

  it("rejects missing or non-array collections", () => {
    expectError(
      { ...createInitialLedgerData(), trades: {} },
      LEDGER_DATA_VALIDATION_ERROR_CODES.INVALID_COLLECTION,
      "trades",
    );
  });

  it("rejects duplicate entity IDs and asset symbols", () => {
    const duplicateAsset = {
      ...createInitialLedgerData().assets[0],
      id: createInitialLedgerData().assets[1].id,
      symbol: createInitialLedgerData().assets[1].symbol,
      binanceMapping: undefined,
    };
    const input = createCompleteLedger();
    input.assets.push(duplicateAsset);

    const result = validateLedgerData(input);

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.errors).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            code: LEDGER_DATA_VALIDATION_ERROR_CODES.DUPLICATE_IDENTIFIER,
          }),
          expect.objectContaining({
            code: LEDGER_DATA_VALIDATION_ERROR_CODES.DUPLICATE_ASSET_SYMBOL,
          }),
        ]),
      );
    }
  });

  it("rejects malformed trade fields and unknown assets", () => {
    const input = createCompleteLedger();
    input.trades[0] = {
      ...input.trades[0],
      assetSymbol: "DOGE",
      quantity: "not-a-number",
    };

    const result = validateLedgerData(input);

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.errors).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ path: "trades[0].assetSymbol" }),
          expect.objectContaining({ path: "trades[0].quantity" }),
        ]),
      );
    }
  });

  it("rejects a ledger whose historical holdings timeline goes negative", () => {
    const input = createCompleteLedger();
    input.trades = input.trades.filter((trade) => trade.id !== "trade-004");

    expectError(
      input,
      LEDGER_DATA_VALIDATION_ERROR_CODES.INVALID_TRADE_TIMELINE,
      "trades",
    );
  });

  it("rejects invalid price snapshots", () => {
    const input = createCompleteLedger();
    input.priceSnapshots[0] = {
      ...input.priceSnapshots[0],
      price: "0",
    };

    expectError(
      input,
      LEDGER_DATA_VALIDATION_ERROR_CODES.INVALID_ENTITY,
      "priceSnapshots[0].price",
    );
  });

  it("rejects dates that Date.parse would otherwise normalize", () => {
    const input = createCompleteLedger();
    input.trades[0] = {
      ...input.trades[0],
      occurredAt: "2026-02-30",
    };

    expectError(
      input,
      LEDGER_DATA_VALIDATION_ERROR_CODES.INVALID_ENTITY,
      "trades[0].occurredAt",
    );
  });

  it("rejects malformed fee rules and dangling fee rule references", () => {
    const input = createCompleteLedger();
    input.feeRules[0] = {
      id: "fee-rule-1",
      name: "Default",
      platform: "Manual",
      assetSymbol: "BTC",
      status: "active",
      type: "percentage",
      rate: "-0.1",
      currency: "USDT",
      createdAt: "2026-07-16T00:00:00Z",
      updatedAt: "2026-07-16T00:00:00Z",
    };
    input.trades[0] = {
      ...input.trades[0],
      feeRuleId: "missing-fee-rule",
    };

    const result = validateLedgerData(input);

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.errors).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ path: "feeRules[0].rate" }),
          expect.objectContaining({
            code: LEDGER_DATA_VALIDATION_ERROR_CODES.INVALID_REFERENCE,
            path: "trades[0].feeRuleId",
          }),
        ]),
      );
    }
  });

  it("accepts the complete fixed and percentage fee rule union", () => {
    const input = createCompleteLedger();
    input.feeRules = [
      {
        id: "fixed-okx-btc-v1",
        name: "OKX BTC fixed",
        platform: "OKX",
        assetSymbol: "BTC",
        status: "inactive",
        type: "fixed",
        amount: "5",
        currency: "USDT",
        createdAt: "2026-07-16T00:00:00Z",
        updatedAt: "2026-07-17T00:00:00Z",
        deactivatedAt: "2026-07-17T00:00:00Z",
      },
      {
        id: "percentage-okx-btc-v2",
        name: "OKX BTC percentage",
        platform: "OKX",
        assetSymbol: "BTC",
        status: "active",
        type: "percentage",
        rate: "0.001",
        currency: "USDT",
        replacesFeeRuleId: "fixed-okx-btc-v1",
        createdAt: "2026-07-17T00:00:00Z",
        updatedAt: "2026-07-17T00:00:00Z",
      },
    ];
    input.trades[0] = {
      ...input.trades[0],
      platform: "OKX",
      feeRuleId: "fixed-okx-btc-v1",
    };

    const result = validateLedgerData(input);

    expect(result).toEqual({ ok: true, value: input });
  });

  it("rejects invalid fee rule targets, states, currency, and trimmed identifiers", () => {
    const input = createCompleteLedger();
    input.feeRules = [
      {
        id: "invalid-fixed",
        name: "Invalid fixed",
        platform: " OKX",
        assetSymbol: "DOGE",
        status: "inactive",
        type: "fixed",
        amount: "-1",
        currency: "USD",
        createdAt: "2026-07-16T00:00:00Z",
        updatedAt: "2026-07-16T00:00:00Z",
      } as never,
    ];

    const result = validateLedgerData(input);

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.errors).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ path: "feeRules[0].platform" }),
          expect.objectContaining({ path: "feeRules[0].assetSymbol" }),
          expect.objectContaining({ path: "feeRules[0].amount" }),
          expect.objectContaining({ path: "feeRules[0].currency" }),
          expect.objectContaining({ path: "feeRules[0].deactivatedAt" }),
        ]),
      );
    }
  });

  it("rejects replacement links that are active, cross-target, missing, or cyclic", () => {
    const input = createCompleteLedger();
    input.feeRules = [
      {
        id: "rule-a",
        name: "Rule A",
        platform: "OKX",
        assetSymbol: "BTC",
        status: "inactive",
        type: "fixed",
        amount: "5",
        currency: "USDT",
        deactivatedAt: "2026-07-17T00:00:00Z",
        replacesFeeRuleId: "rule-b",
        createdAt: "2026-07-16T00:00:00Z",
        updatedAt: "2026-07-17T00:00:00Z",
      },
      {
        id: "rule-b",
        name: "Rule B",
        platform: "OKX",
        assetSymbol: "BTC",
        status: "inactive",
        type: "percentage",
        rate: "0.001",
        currency: "USDT",
        deactivatedAt: "2026-07-18T00:00:00Z",
        replacesFeeRuleId: "rule-a",
        createdAt: "2026-07-17T00:00:00Z",
        updatedAt: "2026-07-18T00:00:00Z",
      },
      {
        id: "rule-c",
        name: "Rule C",
        platform: "Binance",
        assetSymbol: "BTC",
        status: "active",
        type: "fixed",
        amount: "6",
        currency: "USDT",
        replacesFeeRuleId: "rule-a",
        createdAt: "2026-07-18T00:00:00Z",
        updatedAt: "2026-07-18T00:00:00Z",
      },
      {
        id: "rule-d",
        name: "Rule D",
        platform: "OKX",
        assetSymbol: "BTC",
        status: "active",
        type: "fixed",
        amount: "7",
        currency: "USDT",
        replacesFeeRuleId: "missing-rule",
        createdAt: "2026-07-18T00:00:00Z",
        updatedAt: "2026-07-18T00:00:00Z",
      },
    ];

    const result = validateLedgerData(input);

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.errors).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ path: "feeRules[0].replacesFeeRuleId" }),
          expect.objectContaining({ path: "feeRules[2].replacesFeeRuleId" }),
          expect.objectContaining({ path: "feeRules[3].replacesFeeRuleId" }),
        ]),
      );
    }
  });

  it("rejects blank or whitespace-normalized persisted trade platforms", () => {
    const input = createCompleteLedger();
    input.trades[0] = { ...input.trades[0], platform: " OKX " };

    expectError(
      input,
      LEDGER_DATA_VALIDATION_ERROR_CODES.INVALID_ENTITY,
      "trades[0].platform",
    );
  });

  it("does not mutate deeply frozen runtime input", () => {
    const input = createCompleteLedger();
    deepFreeze(input);

    expect(() => validateLedgerData(input)).not.toThrow();
  });

  it("exposes only independently valid trades with their original indexes for read-only preflight", () => {
    const input = createCompleteLedger();
    input.trades = [
      {
        ...input.trades[0],
        id: "invalid-first",
        quantity: "not-a-decimal",
      },
      {
        ...input.trades[0],
        id: "valid-second",
      },
      {
        ...input.trades[1],
        id: "valid-third",
      },
    ];

    expect(collectValidLedgerTradeProjections(input)).toEqual([
      {
        originalIndex: 1,
        trade: expect.objectContaining({ id: "valid-second" }),
      },
      {
        originalIndex: 2,
        trade: expect.objectContaining({ id: "valid-third" }),
      },
    ]);
  });
});

function deepFreeze<T>(value: T): T {
  if (typeof value !== "object" || value === null || Object.isFrozen(value)) {
    return value;
  }

  Object.freeze(value);
  for (const nestedValue of Object.values(value)) {
    deepFreeze(nestedValue);
  }

  return value;
}
