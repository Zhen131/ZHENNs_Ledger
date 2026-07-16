import { describe, expect, it } from "vitest";

import type { LedgerData } from "../models";
import { createInitialLedgerData } from "../state/initialLedgerData";
import {
  createPriceSnapshot,
  sampleTrades,
} from "../test/fixtures";
import {
  LEDGER_DATA_VALIDATION_ERROR_CODES,
  validateLedgerData,
} from "./ledgerDataValidator";

function createCompleteLedger(): LedgerData {
  return {
    ...createInitialLedgerData(),
    trades: structuredClone(sampleTrades),
    priceSnapshots: [
      createPriceSnapshot("price-btc", "BTC", "70000", "2026-07-16"),
    ],
    feeRules: [
      {
        id: "fee-rule-1",
        name: "Default",
        platform: "Manual",
        type: "percentage",
        rate: "0.001",
        currency: "USD",
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

  it("rejects non-object roots and unsupported schema versions", () => {
    expectError(
      "invalid",
      LEDGER_DATA_VALIDATION_ERROR_CODES.INVALID_ROOT,
      "ledgerData",
    );
    expectError(
      { ...createInitialLedgerData(), schemaVersion: 2 },
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
      ...input.feeRules[0],
      rate: "-0.1",
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

  it("does not mutate deeply frozen runtime input", () => {
    const input = createCompleteLedger();
    deepFreeze(input);

    expect(() => validateLedgerData(input)).not.toThrow();
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
