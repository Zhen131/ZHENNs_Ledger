import { describe, expect, it } from "vitest";

import { createInitialLedgerData } from "../state/initialLedgerData";
import {
  DEFAULT_LEDGER_RESOURCE_LIMITS,
  LEDGER_RESOURCE_POLICY_ERROR_CODES,
  evaluateLedgerByteLengthResourcePolicy,
  evaluateLedgerJsonResourcePolicy,
  evaluateLedgerResourcePolicy,
} from "./resourcePolicy";

describe("Ledger resource policy", () => {
  it("accepts collections and strings exactly at their configured limits", () => {
    const ledger = createInitialLedgerData();
    ledger.assets = Array.from(
      { length: DEFAULT_LEDGER_RESOURCE_LIMITS.assets },
      (_, index) => ({
        ...ledger.assets[0],
        id: `asset-${index}`,
        symbol: `A${index}`,
        name: "n".repeat(DEFAULT_LEDGER_RESOURCE_LIMITS.name),
        quoteCurrency: "U".repeat(DEFAULT_LEDGER_RESOURCE_LIMITS.currency),
      }),
    );

    expect(evaluateLedgerResourcePolicy(ledger)).toEqual({ ok: true });
  });

  it("rejects a collection that exceeds its limit by one", () => {
    const ledger = createInitialLedgerData();
    ledger.feeRules = Array.from(
      { length: DEFAULT_LEDGER_RESOURCE_LIMITS.feeRules + 1 },
      (_, index) => ({
        id: `fee-${index}`,
        name: "fee",
        platform: "manual",
        type: "percentage" as const,
        rate: "0.001",
        currency: "USD",
        createdAt: "2026-07-21T00:00:00Z",
        updatedAt: "2026-07-21T00:00:00Z",
      }),
    );

    const result = evaluateLedgerResourcePolicy(ledger);

    expect(result).toEqual({
      ok: false,
      errors: [
        expect.objectContaining({
          code: LEDGER_RESOURCE_POLICY_ERROR_CODES.COLLECTION_LIMIT_EXCEEDED,
          path: "feeRules",
          limit: DEFAULT_LEDGER_RESOURCE_LIMITS.feeRules,
          actual: DEFAULT_LEDGER_RESOURCE_LIMITS.feeRules + 1,
        }),
      ],
    });
  });

  it("rejects a note that exceeds the configured limit by one", () => {
    const ledger = createInitialLedgerData();
    ledger.trades = [
      {
        id: "trade-too-long-note",
        occurredAt: "2026-07-21",
        timePrecision: "day",
        type: "buy",
        assetSymbol: "BTC",
        quantity: "1",
        price: "100",
        totalValue: "100",
        currency: "USD",
        fee: "0",
        feeCurrency: "USD",
        note: "n".repeat(DEFAULT_LEDGER_RESOURCE_LIMITS.note + 1),
        createdAt: "2026-07-21T00:00:00Z",
        updatedAt: "2026-07-21T00:00:00Z",
      },
    ];

    const result = evaluateLedgerResourcePolicy(ledger);

    expect(result).toEqual({
      ok: false,
      errors: [
        expect.objectContaining({
          code: LEDGER_RESOURCE_POLICY_ERROR_CODES.STRING_LIMIT_EXCEEDED,
          path: "trades[0].note",
          limit: DEFAULT_LEDGER_RESOURCE_LIMITS.note,
          actual: DEFAULT_LEDGER_RESOURCE_LIMITS.note + 1,
        }),
      ],
    });
  });

  it("counts UTF-8 bytes before JSON parsing", () => {
    const serialized = "x".repeat(9);

    const result = evaluateLedgerJsonResourcePolicy(serialized, {
      ...DEFAULT_LEDGER_RESOURCE_LIMITS,
      fileBytes: 8,
    });

    expect(result).toEqual({
      ok: false,
      errors: [
        expect.objectContaining({
          code: LEDGER_RESOURCE_POLICY_ERROR_CODES.FILE_TOO_LARGE,
          path: "file",
          limit: 8,
          actual: 9,
        }),
      ],
    });
  });

  it("shares the file byte limit with callers that have not read text yet", () => {
    expect(
      evaluateLedgerByteLengthResourcePolicy(9, {
        ...DEFAULT_LEDGER_RESOURCE_LIMITS,
        fileBytes: 8,
      }),
    ).toEqual({
      ok: false,
      errors: [
        expect.objectContaining({
          code: LEDGER_RESOURCE_POLICY_ERROR_CODES.FILE_TOO_LARGE,
          path: "file",
          limit: 8,
          actual: 9,
        }),
      ],
    });
  });
});
