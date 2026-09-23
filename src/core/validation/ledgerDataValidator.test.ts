import { describe, expect, it } from "vitest";

import type {
  AssetTransfer,
  AssetTransferCategory,
  LedgerData,
} from "@/core/models";
import { createInitialLedgerData } from "@/core/state";
import {
  createPriceSnapshot,
  sampleTrades,
} from "@/test-support";
import {
  collectValidLedgerTradeProjections,
  validateLedgerData,
} from "./ledgerDataValidator";
import { LEDGER_DATA_VALIDATION_ERROR_CODES } from "./ledgerDataValidatorSchema";

function createCompleteLedger(): LedgerData {
  const initialLedger = createInitialLedgerData();
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

  it("accepts optional runtime-recognized time zones on all four fact types", () => {
    const input = createCompleteLedger();
    input.trades[0] = { ...input.trades[0], occurredTimeZone: "Asia/Shanghai" };
    input.cashEvents = [
      { ...cashFlow("deposit", "1", "cash-time-zone"), occurredTimeZone: "UTC" },
    ];
    input.assetTransfers = [
      {
        ...transferForCategory("external-in"),
        occurredTimeZone: "Europe/Budapest",
      },
    ];
    input.priceSnapshots[0] = {
      ...input.priceSnapshots[0],
      occurredTimeZone: "Asia/Kathmandu",
    };

    expect(validateLedgerData(input)).toEqual({ ok: true, value: input });
  });

  it("rejects a time zone that the runtime does not recognize", () => {
    const input = createCompleteLedger();
    input.trades[0] = {
      ...input.trades[0],
      occurredTimeZone: "Not/A-Time-Zone",
    };

    expectError(
      input,
      LEDGER_DATA_VALIDATION_ERROR_CODES.INVALID_ENTITY,
      "trades[0].occurredTimeZone",
    );
  });

  it("rejects an offset that disagrees with its occurred time zone and accepts Z for UTC", () => {
    const inconsistent = createCompleteLedger();
    inconsistent.trades[0] = {
      ...inconsistent.trades[0],
      occurredAt: "2026-01-15T09:30:00+08:00",
      occurredTimeZone: "Europe/Budapest",
    };
    expectError(inconsistent, LEDGER_DATA_VALIDATION_ERROR_CODES.INVALID_ENTITY, "trades[0].occurredAt");

    const consistent = createCompleteLedger();
    consistent.priceSnapshots[0] = {
      ...consistent.priceSnapshots[0],
      recordedAt: "2026-01-15T09:30:00Z",
      occurredTimeZone: "UTC",
    };
    expect(validateLedgerData(consistent)).toEqual({ ok: true, value: consistent });
  });

  it("preserves a non-zero fee paid in another local asset", () => {
    const input = createCompleteLedger();
    input.trades[0] = {
      ...input.trades[0],
      fee: "1",
      feeCurrency: "ETH",
    };

    const result = validateLedgerData(input);

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.trades[0]).toEqual(input.trades[0]);
    }
  });

  it("accepts a valid same-asset fee timeline and rejects fee-driven overselling", () => {
    const input = createInitialLedgerData();
    input.trades = [
      {
        id: "asset-fee-buy",
        occurredAt: "2026-07-01",
        timePrecision: "day",
        type: "buy",
        assetSymbol: "BTC",
        quantity: "10",
        price: "10",
        totalValue: "100",
        currency: "USDT",
        fee: "1",
        feeCurrency: "BTC",
        rawText: "Fictional BTC buy with a BTC fee.",
        createdAt: "2026-07-01T00:00:00Z",
        updatedAt: "2026-07-01T00:00:00Z",
      },
      {
        id: "asset-fee-sell",
        occurredAt: "2026-07-02",
        timePrecision: "day",
        type: "sell",
        assetSymbol: "BTC",
        quantity: "8.5",
        price: "20",
        totalValue: "170",
        currency: "USDT",
        fee: "0.5",
        feeCurrency: "BTC",
        rawText: "Fictional BTC sell with a BTC fee.",
        createdAt: "2026-07-02T00:00:00Z",
        updatedAt: "2026-07-02T00:00:00Z",
      },
    ];

    expect(validateLedgerData(input).ok).toBe(true);

    input.trades[1] = { ...input.trades[1], quantity: "8.6", totalValue: "172" };
    expectError(
      input,
      LEDGER_DATA_VALIDATION_ERROR_CODES.INVALID_TRADE_TIMELINE,
      "trades",
    );
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
      { ...createInitialLedgerData(), schemaVersion: 2 },
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
      binanceMapping: null,
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

  it("accepts canonical cash flows and a zero-delta balance adjustment", () => {
    const input = createInitialLedgerData();
    input.cashEvents = [
      cashFlow("deposit", "9999999999999999999999999999999999999999", "cash-40"),
      cashFlow("withdrawal", "0.000000000000000001", "cash-18"),
      {
        id: "cash-adjustment",
        occurredAt: "2026-08-18",
        timePrecision: "day",
        type: "balance-adjustment",
        currency: "USDT",
        balanceBefore: "-1",
        targetBalance: "-1",
        adjustmentAmount: "0",
        createdAt: "2026-08-18T08:00:00.000Z",
        updatedAt: "2026-08-18T08:00:00.000Z",
      },
    ];

    expect(validateLedgerData(input)).toEqual({ ok: true, value: input });
  });

  it.each(["0", "-1", "01", "1e3", "+1", "-0"])(
    "rejects non-positive or non-canonical flow amount %s",
    (amount) => {
      const input = createInitialLedgerData();
      input.cashEvents = [cashFlow("deposit", amount, "cash-invalid")];

      expectError(
        input,
        LEDGER_DATA_VALIDATION_ERROR_CODES.INVALID_ENTITY,
        "cashEvents[0].amount",
      );
    },
  );

  it("rejects inconsistent adjustment arithmetic and union-only extra fields", () => {
    const input = createInitialLedgerData();
    input.cashEvents = [
      {
        id: "cash-invalid-adjustment",
        occurredAt: "2026-08-18",
        timePrecision: "day",
        type: "balance-adjustment",
        currency: "USDT",
        amount: "1",
        balanceBefore: "10",
        targetBalance: "8",
        adjustmentAmount: "-1",
        createdAt: "2026-08-18T08:00:00.000Z",
        updatedAt: "2026-08-18T08:00:00.000Z",
      } as never,
    ];

    expectError(
      input,
      LEDGER_DATA_VALIDATION_ERROR_CODES.INVALID_ENTITY,
      "cashEvents[0].amount",
    );
    expectError(
      input,
      LEDGER_DATA_VALIDATION_ERROR_CODES.INVALID_ENTITY,
      "cashEvents[0].adjustmentAmount",
    );
  });

  it("enforces global IDs and exact V4 root and asset shapes", () => {
    const duplicate = createCompleteLedger();
    duplicate.cashEvents = [
      cashFlow("deposit", "1", duplicate.trades[0].id),
    ];
    expectError(
      duplicate,
      LEDGER_DATA_VALIDATION_ERROR_CODES.DUPLICATE_IDENTIFIER,
      "cashEvents[0].id",
    );

    expectError(
      { ...createInitialLedgerData(), currentCashBalance: "0" },
      LEDGER_DATA_VALIDATION_ERROR_CODES.INVALID_ENTITY,
      "ledgerData.currentCashBalance",
    );

    const missingMapping = createInitialLedgerData();
    const assetWithoutMapping = {
      ...missingMapping.assets[0],
    } as Record<string, unknown>;
    delete assetWithoutMapping.binanceMapping;
    expectError(
      {
        ...missingMapping,
        assets: [assetWithoutMapping, ...missingMapping.assets.slice(1)],
      },
      LEDGER_DATA_VALIDATION_ERROR_CODES.INVALID_ENTITY,
      "assets[0].binanceMapping",
    );
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

describe("V4 asset transfer validation contract", () => {
  it("accepts all four categories when their exact combinations form a valid timeline", () => {
    const ledger = createInitialLedgerData();
    ledger.assetTransfers = [
      {
        ...transferForCategory("external-in"),
        id: "external-in-valid",
        occurredAt: "2026-08-01",
        quantity: "100",
        unitPrice: "10",
        toLocation: "exchange",
      },
      {
        ...transferForCategory("internal"),
        id: "internal-valid",
        occurredAt: "2026-08-02",
        quantity: "20",
        networkFee: "1",
        fromLocation: "exchange",
        toLocation: "cold-wallet",
      },
      {
        ...transferForCategory("gain"),
        id: "gain-valid",
        occurredAt: "2026-08-03",
        quantity: "5",
        unitPrice: "4",
        toLocation: "cold-wallet-earn",
      },
      {
        ...transferForCategory("external-out"),
        id: "external-out-valid",
        occurredAt: "2026-08-04",
        quantity: "10",
        networkFee: "1",
        fromLocation: "exchange",
      },
    ];

    const result = validateLedgerData(ledger);
    expect(result).toEqual({ ok: true, value: ledger });
  });

  it.each([
    {
      name: "internal requires fromLocation",
      input: withoutTransferField(
        transferForCategory("internal"),
        "fromLocation",
      ),
      path: "assetTransfers[0].fromLocation",
    },
    {
      name: "internal requires toLocation",
      input: withoutTransferField(
        transferForCategory("internal"),
        "toLocation",
      ),
      path: "assetTransfers[0].toLocation",
    },
    {
      name: "internal locations must differ",
      input: {
        ...transferForCategory("internal"),
        toLocation: "exchange",
      },
      path: "assetTransfers[0].toLocation",
    },
    {
      name: "internal forbids unitPrice",
      input: { ...transferForCategory("internal"), unitPrice: "1" },
      path: "assetTransfers[0].unitPrice",
    },
    {
      name: "internal networkFee must be positive when present",
      input: { ...transferForCategory("internal"), networkFee: "0" },
      path: "assetTransfers[0].networkFee",
    },
    {
      name: "external-in forbids fromLocation",
      input: {
        ...transferForCategory("external-in"),
        fromLocation: "exchange",
      },
      path: "assetTransfers[0].fromLocation",
    },
    {
      name: "external-in requires toLocation",
      input: withoutTransferField(
        transferForCategory("external-in"),
        "toLocation",
      ),
      path: "assetTransfers[0].toLocation",
    },
    {
      name: "external-in requires unitPrice",
      input: withoutTransferField(
        transferForCategory("external-in"),
        "unitPrice",
      ),
      path: "assetTransfers[0].unitPrice",
    },
    {
      name: "external-in forbids networkFee",
      input: {
        ...transferForCategory("external-in"),
        networkFee: "0.1",
      },
      path: "assetTransfers[0].networkFee",
    },
    {
      name: "external-out requires fromLocation",
      input: withoutTransferField(
        transferForCategory("external-out"),
        "fromLocation",
      ),
      path: "assetTransfers[0].fromLocation",
    },
    {
      name: "external-out forbids toLocation",
      input: {
        ...transferForCategory("external-out"),
        toLocation: "cold-wallet",
      },
      path: "assetTransfers[0].toLocation",
    },
    {
      name: "external-out forbids unitPrice",
      input: { ...transferForCategory("external-out"), unitPrice: "1" },
      path: "assetTransfers[0].unitPrice",
    },
    {
      name: "external-out networkFee must be positive when present",
      input: { ...transferForCategory("external-out"), networkFee: "0" },
      path: "assetTransfers[0].networkFee",
    },
    {
      name: "gain forbids fromLocation",
      input: {
        ...transferForCategory("gain"),
        fromLocation: "exchange",
      },
      path: "assetTransfers[0].fromLocation",
    },
    {
      name: "gain requires toLocation",
      input: withoutTransferField(transferForCategory("gain"), "toLocation"),
      path: "assetTransfers[0].toLocation",
    },
    {
      name: "gain requires unitPrice",
      input: withoutTransferField(transferForCategory("gain"), "unitPrice"),
      path: "assetTransfers[0].unitPrice",
    },
    {
      name: "gain forbids networkFee",
      input: { ...transferForCategory("gain"), networkFee: "0.1" },
      path: "assetTransfers[0].networkFee",
    },
  ])("T1-09 rejects $name", ({ input, path }) => {
    expectError(
      ledgerWithTransfer(input),
      LEDGER_DATA_VALIDATION_ERROR_CODES.INVALID_ENTITY,
      path,
    );
  });

  it.each([
    ["deposit", "gain"],
    ["withdrawal", "gain"],
    ["internal-move", "gain"],
    ["airdrop", "external-in"],
    ["interest", "external-in"],
    ["platform-gift", "external-in"],
  ] as const)(
    "T1-09 rejects reason %s on category %s",
    (reason, category) => {
      expectError(
        ledgerWithTransfer({
          ...transferForCategory(category),
          reason,
        }),
        LEDGER_DATA_VALIDATION_ERROR_CODES.INVALID_ENTITY,
        "assetTransfers[0].reason",
      );
    },
  );

  it("rejects unknown keys, assets, decimal bounds, and cross-collection IDs", () => {
    expectError(
      ledgerWithTransfer({
        ...transferForCategory("external-in"),
        unexpected: true,
      }),
      LEDGER_DATA_VALIDATION_ERROR_CODES.INVALID_ENTITY,
      "assetTransfers[0].unexpected",
    );
    expectError(
      ledgerWithTransfer({
        ...transferForCategory("external-in"),
        assetSymbol: "DOGE",
      }),
      LEDGER_DATA_VALIDATION_ERROR_CODES.INVALID_REFERENCE,
      "assetTransfers[0].assetSymbol",
    );
    expectError(
      ledgerWithTransfer({
        ...transferForCategory("external-in"),
        quantity: "12345678901234567890123456789012345678901",
        unitPrice: "1.1234567890123456789",
      }),
      LEDGER_DATA_VALIDATION_ERROR_CODES.INVALID_ENTITY,
      "assetTransfers[0].quantity",
    );
    expectError(
      ledgerWithTransfer({
        ...transferForCategory("external-in"),
        quantity: "1",
        unitPrice: "1.1234567890123456789",
      }),
      LEDGER_DATA_VALIDATION_ERROR_CODES.INVALID_ENTITY,
      "assetTransfers[0].unitPrice",
    );

    const duplicateLedger = createInitialLedgerData();
    duplicateLedger.assetTransfers = [
      {
        ...transferForCategory("external-in"),
        id: duplicateLedger.assets[0].id,
      },
    ];
    expectError(
      duplicateLedger,
      LEDGER_DATA_VALIDATION_ERROR_CODES.DUPLICATE_IDENTIFIER,
      "assetTransfers[0].id",
    );
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

function cashFlow(
  type: "deposit" | "withdrawal" | "external-expense",
  amount: string,
  id: string,
) {
  return {
    id,
    occurredAt: "2026-08-18",
    timePrecision: "day" as const,
    type,
    currency: "USDT" as const,
    amount,
    createdAt: "2026-08-18T08:00:00.000Z",
    updatedAt: "2026-08-18T08:00:00.000Z",
  };
}

function transferForCategory(
  category: AssetTransferCategory,
): AssetTransfer {
  const common = {
    id: `transfer-${category}`,
    occurredAt: "2026-08-18",
    timePrecision: "day" as const,
    assetSymbol: "BTC",
    quantity: "1",
    createdAt: "2026-08-18T08:00:00.000Z",
    updatedAt: "2026-08-18T08:00:00.000Z",
  };
  switch (category) {
    case "internal":
      return {
        ...common,
        category,
        reason: "internal-move",
        fromLocation: "exchange",
        toLocation: "cold-wallet",
      };
    case "external-in":
      return {
        ...common,
        category,
        reason: "deposit",
        unitPrice: "10",
        toLocation: "exchange",
      };
    case "external-out":
      return {
        ...common,
        category,
        reason: "withdrawal",
        fromLocation: "exchange",
      };
    case "gain":
      return {
        ...common,
        category,
        reason: "airdrop",
        unitPrice: "10",
        toLocation: "cold-wallet-earn",
      };
  }
}

function withoutTransferField(
  transfer: AssetTransfer,
  field: "fromLocation" | "toLocation" | "unitPrice",
): Record<string, unknown> {
  const value: Record<string, unknown> = { ...transfer };
  Reflect.deleteProperty(value, field);
  return value;
}

function ledgerWithTransfer(transfer: unknown): unknown {
  return {
    ...createInitialLedgerData(),
    assetTransfers: [transfer],
  };
}
