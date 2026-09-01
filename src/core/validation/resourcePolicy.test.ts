import { describe, expect, it } from "vitest";

import {
  createBackupEnvelope,
  parseBackupJson,
  serializeBackupEnvelope,
} from "@/features/backup";
import { createInitialLedgerData } from "@/core/state";
import {
  DEFAULT_LEDGER_RESOURCE_LIMITS,
  LEDGER_RESOURCE_POLICY_ERROR_CODES,
  evaluateLedgerByteLengthResourcePolicy,
  evaluateLedgerJsonResourcePolicy,
  evaluateLedgerResourcePolicy,
  evaluateLedgerResourcePolicyAfterTradeAppend,
} from "./resourcePolicy";

function padSerializedBackupToBytes(serialized: string, targetBytes: number): string {
  const currentBytes = new TextEncoder().encode(serialized).byteLength;

  if (currentBytes > targetBytes) {
    throw new Error("Serialized fixture already exceeds target");
  }

  return `${serialized}${" ".repeat(targetBytes - currentBytes)}`;
}

describe("Ledger resource policy", () => {
  it("matches the full policy for a legal appended trade and its bounded fields", () => {
    const ledger = createInitialLedgerData();
    const trade = {
      id: "incremental-resource-trade",
      occurredAt: "2026-09-01",
      timePrecision: "day" as const,
      type: "buy" as const,
      assetSymbol: "BTC",
      quantity: "1",
      price: "10",
      totalValue: "10",
      currency: "USDT" as const,
      fee: "0",
      feeCurrency: "USDT" as const,
      note: "n".repeat(DEFAULT_LEDGER_RESOURCE_LIMITS.note + 1),
      createdAt: "2026-09-01T10:00:00.000Z",
      updatedAt: "2026-09-01T10:00:00.000Z",
    };
    ledger.trades.push(trade);

    expect(
      evaluateLedgerResourcePolicyAfterTradeAppend(ledger, trade),
    ).toEqual(evaluateLedgerResourcePolicy(ledger));
  });

  it("accepts collections and strings exactly at their configured limits", () => {
    const ledger = createInitialLedgerData();
    ledger.assets = Array.from(
      { length: DEFAULT_LEDGER_RESOURCE_LIMITS.assets },
      (_, index) => ({
        ...ledger.assets[0],
        id: `asset-${index}`,
        symbol: `A${index}`,
        name: "n".repeat(DEFAULT_LEDGER_RESOURCE_LIMITS.name),
        quoteCurrency: "U".repeat(
          DEFAULT_LEDGER_RESOURCE_LIMITS.currency,
        ) as never,
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
        assetSymbol: "BTC",
        status: "active" as const,
        type: "percentage" as const,
        rate: "0.001",
        currency: "USDT" as const,
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

  it("bounds the persisted fee rule decimal field", () => {
    const ledger = createInitialLedgerData();
    ledger.feeRules = [
      {
        id: "fee-too-long-rate",
        name: "fee",
        platform: "OKX",
        assetSymbol: "BTC",
        status: "active",
        type: "percentage",
        rate: `0.${"1".repeat(DEFAULT_LEDGER_RESOURCE_LIMITS.decimal)}`,
        currency: "USDT",
        createdAt: "2026-08-10T00:00:00.000Z",
        updatedAt: "2026-08-10T00:00:00.000Z",
      },
    ];

    expect(evaluateLedgerResourcePolicy(ledger)).toEqual({
      ok: false,
      errors: [
        expect.objectContaining({
          code: LEDGER_RESOURCE_POLICY_ERROR_CODES.STRING_LIMIT_EXCEEDED,
          path: "feeRules[0].rate",
          limit: DEFAULT_LEDGER_RESOURCE_LIMITS.decimal,
          actual: DEFAULT_LEDGER_RESOURCE_LIMITS.decimal + 2,
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
        currency: "USDT",
        fee: "0",
        feeCurrency: "USDT",
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

  it("bounds the V4 asset-transfer collection and persisted strings", () => {
    const ledger = createInitialLedgerData();
    ledger.assetTransfers = [
      {
        id: "i".repeat(DEFAULT_LEDGER_RESOURCE_LIMITS.id + 1),
        occurredAt: "2026-08-18",
        timePrecision: "day",
        assetSymbol: "S".repeat(DEFAULT_LEDGER_RESOURCE_LIMITS.symbol + 1),
        quantity: "1".repeat(DEFAULT_LEDGER_RESOURCE_LIMITS.decimal + 1),
        category: "external-in",
        reason: "deposit",
        unitPrice: "2".repeat(DEFAULT_LEDGER_RESOURCE_LIMITS.decimal + 1),
        networkFee: "3".repeat(
          DEFAULT_LEDGER_RESOURCE_LIMITS.decimal + 1,
        ),
        toLocation: "exchange",
        note: "n".repeat(DEFAULT_LEDGER_RESOURCE_LIMITS.note + 1),
        createdAt: "2026-08-18T08:00:00.000Z",
        updatedAt: "2026-08-18T08:00:00.000Z",
      },
    ];

    const result = evaluateLedgerResourcePolicy(ledger, {
      assetTransfers: 0,
    });

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.errors).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            code: LEDGER_RESOURCE_POLICY_ERROR_CODES.COLLECTION_LIMIT_EXCEEDED,
            path: "assetTransfers",
          }),
          expect.objectContaining({ path: "assetTransfers[0].id" }),
          expect.objectContaining({ path: "assetTransfers[0].assetSymbol" }),
          expect.objectContaining({ path: "assetTransfers[0].quantity" }),
          expect.objectContaining({ path: "assetTransfers[0].unitPrice" }),
          expect.objectContaining({ path: "assetTransfers[0].networkFee" }),
          expect.objectContaining({ path: "assetTransfers[0].note" }),
        ]),
      );
    }
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

  it("accepts a legal backup at exactly 8 MiB and rejects the next byte before parsing", () => {
    const envelope = createBackupEnvelope(createInitialLedgerData(), {
      appVersion: "0.1.0",
      exportedAt: "2026-07-23T12:34:56.000Z",
    });
    if (!envelope.ok) throw new Error("Fixture must be valid");
    const serializedBackup = padSerializedBackupToBytes(
      serializeBackupEnvelope(envelope.value),
      DEFAULT_LEDGER_RESOURCE_LIMITS.fileBytes,
    );

    expect(evaluateLedgerJsonResourcePolicy(serializedBackup)).toEqual({
      ok: true,
    });
    expect(parseBackupJson(serializedBackup)).toEqual({
      ok: true,
      value: expect.any(Object),
    });
    expect(
      evaluateLedgerByteLengthResourcePolicy(serializedBackup.length),
    ).toEqual({ ok: true });

    const oversizedBackup = `${serializedBackup} `;
    expect(evaluateLedgerJsonResourcePolicy(oversizedBackup)).toEqual({
      ok: false,
      errors: [
        expect.objectContaining({
          code: LEDGER_RESOURCE_POLICY_ERROR_CODES.FILE_TOO_LARGE,
          limit: DEFAULT_LEDGER_RESOURCE_LIMITS.fileBytes,
          actual: DEFAULT_LEDGER_RESOURCE_LIMITS.fileBytes + 1,
        }),
      ],
    });
    expect(
      evaluateLedgerByteLengthResourcePolicy(oversizedBackup.length),
    ).toEqual({
      ok: false,
      errors: [
        expect.objectContaining({
          code: LEDGER_RESOURCE_POLICY_ERROR_CODES.FILE_TOO_LARGE,
          limit: DEFAULT_LEDGER_RESOURCE_LIMITS.fileBytes,
          actual: DEFAULT_LEDGER_RESOURCE_LIMITS.fileBytes + 1,
        }),
      ],
    });
  });
});
