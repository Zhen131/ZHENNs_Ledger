import { describe, expect, it, vi } from "vitest";

import type { LedgerData, TradeDraft } from "../models";
import { createInitialLedgerData } from "../state/initialLedgerData";
import { createSimpleTrade } from "../test/fixtures";
import {
  TRADE_VALIDATION_ERROR_CODES,
  validateTradeDraft,
} from "../validators/tradeValidator";
import { getPositionsFromLedger } from "./positionService";
import {
  TRADE_SERVICE_ERROR_CODES,
  createValidatedTrade,
  type TradeServiceDependencies,
} from "./tradeService";

const TIMESTAMP = "2026-07-14T12:00:00.000Z";

const validBuy: TradeDraft = {
  occurredAt: "2026-07-14",
  timePrecision: "day",
  type: "buy",
  assetSymbol: "BTC",
  quantity: "0.001",
  price: "70000",
  totalValue: "70",
  currency: "USD",
};

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
      feeCurrency: "USD",
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

  it("preserves a validated fee currency instead of replacing it", () => {
    const result = createValidatedTrade(
      { ...validBuy, fee: "1", feeCurrency: "CNY" },
      createInitialLedgerData(),
      createDependencies(["trade-new"]),
    );

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.trade.fee).toBe("1");
      expect(result.trade.feeCurrency).toBe("CNY");
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

describe("createValidatedTrade validation failures", () => {
  const validationCases: Array<{
    name: string;
    input: unknown;
    ledgerData: LedgerData;
    code: string;
    field: string;
  }> = [
    {
      name: "unknown asset",
      input: { ...validBuy, assetSymbol: "DOGE" },
      ledgerData: createInitialLedgerData(),
      code: TRADE_VALIDATION_ERROR_CODES.ASSET_NOT_FOUND,
      field: "assetSymbol",
    },
    {
      name: "invalid decimal",
      input: { ...validBuy, quantity: "not-a-number" },
      ledgerData: createInitialLedgerData(),
      code: TRADE_VALIDATION_ERROR_CODES.INVALID_DECIMAL,
      field: "quantity",
    },
    {
      name: "sell without holdings",
      input: createSell("1", "2026-04-01"),
      ledgerData: createInitialLedgerData(),
      code: TRADE_VALIDATION_ERROR_CODES.INSUFFICIENT_HOLDINGS,
      field: "quantity",
    },
    {
      name: "direct oversell",
      input: createSell("11", "2026-04-02"),
      ledgerData: createLedgerData({
        trades: [
          createSimpleTrade("buy-ada", "buy", "ADA", "10", "2026-04-01"),
        ],
      }),
      code: TRADE_VALIDATION_ERROR_CODES.INSUFFICIENT_HOLDINGS,
      field: "quantity",
    },
    {
      name: "future buy cannot support earlier sell",
      input: createSell("10", "2026-04-01"),
      ledgerData: createLedgerData({
        trades: [
          createSimpleTrade("future-buy", "buy", "ADA", "10", "2026-04-10"),
        ],
      }),
      code: TRADE_VALIDATION_ERROR_CODES.INSUFFICIENT_HOLDINGS,
      field: "quantity",
    },
    {
      name: "backfilled sell breaks a later sell",
      input: createSell("5", "2026-04-02"),
      ledgerData: createLedgerData({
        trades: [
          createSimpleTrade("buy-ada", "buy", "ADA", "10", "2026-04-01"),
          createSimpleTrade("sell-ada", "sell", "ADA", "10", "2026-04-03"),
        ],
      }),
      code: TRADE_VALIDATION_ERROR_CODES.INSUFFICIENT_HOLDINGS,
      field: "quantity",
    },
    {
      name: "asset quote currency mismatch",
      input: { ...validBuy, currency: "CNY" },
      ledgerData: createInitialLedgerData(),
      code: TRADE_VALIDATION_ERROR_CODES.CURRENCY_MISMATCH,
      field: "currency",
    },
    {
      name: "existing same-asset currency mismatch",
      input: validBuy,
      ledgerData: createLedgerData({
        trades: [
          {
            ...createSimpleTrade("buy-btc", "buy", "BTC", "1"),
            currency: "CNY",
          },
        ],
      }),
      code: TRADE_VALIDATION_ERROR_CODES.CURRENCY_MISMATCH,
      field: "currency",
    },
  ];

  it.each(validationCases)(
    "returns the original validator error for $name",
    ({ input, ledgerData, code, field }) => {
      const dependencies = createDependencies(["unused-id"]);
      const expectedValidation = validateTradeDraft(input, {
        assets: ledgerData.assets,
        priorTrades: ledgerData.trades,
      });

      const result = createValidatedTrade(input, ledgerData, dependencies);

      expect(expectedValidation.ok).toBe(false);
      expect(result.ok).toBe(false);
      if (!result.ok && result.kind === "validation") {
        expect(result.errors).toEqual(
          expectedValidation.ok ? [] : expectedValidation.errors,
        );
        expect(result.errors).toEqual(
          expect.arrayContaining([
            expect.objectContaining({ code, field }),
          ]),
        );
      }
      expect(dependencies.generateId).not.toHaveBeenCalled();
      expect(dependencies.now).not.toHaveBeenCalled();
    },
  );
});

describe("createValidatedTrade ID and dependency handling", () => {
  it("retries one collision and stops after the second ID succeeds", () => {
    const ledgerData = createLedgerData({
      trades: [createSimpleTrade("existing-id", "buy", "BTC", "1")],
    });
    const dependencies = createDependencies(["existing-id", "unique-id"]);

    const result = createValidatedTrade(validBuy, ledgerData, dependencies);

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.trade.id).toBe("unique-id");
    }
    expect(dependencies.generateId).toHaveBeenCalledTimes(2);
    expect(dependencies.now).toHaveBeenCalledTimes(1);
  });

  it("allows the third and final ID attempt to succeed", () => {
    const ledgerData = createLedgerData({
      trades: [
        createSimpleTrade("collision-1", "buy", "BTC", "1"),
        createSimpleTrade("collision-2", "buy", "BTC", "1"),
      ],
    });
    const dependencies = createDependencies([
      "collision-1",
      "collision-2",
      "unique-id",
    ]);

    const result = createValidatedTrade(validBuy, ledgerData, dependencies);

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.trade.id).toBe("unique-id");
    }
    expect(dependencies.generateId).toHaveBeenCalledTimes(3);
    expect(dependencies.now).toHaveBeenCalledTimes(1);
  });

  it("returns a service error after three ID collisions without reading time", () => {
    const ledgerData = createLedgerData({
      trades: [createSimpleTrade("collision", "buy", "BTC", "1")],
    });
    const dependencies = createDependencies([
      "collision",
      "collision",
      "collision",
    ]);

    const result = createValidatedTrade(validBuy, ledgerData, dependencies);

    expect(result).toEqual({
      ok: false,
      kind: "service",
      error: {
        code: TRADE_SERVICE_ERROR_CODES.ID_GENERATION_EXHAUSTED,
        message: expect.any(String),
      },
    });
    expect(dependencies.generateId).toHaveBeenCalledTimes(3);
    expect(dependencies.now).not.toHaveBeenCalled();
    expect(result).not.toHaveProperty("trade");
  });

  it("reports only a generateId dependency failure when ID generation throws", () => {
    const dependencies: TradeServiceDependencies = {
      generateId: vi.fn(() => {
        throw new Error("ID source unavailable");
      }),
      now: vi.fn(() => TIMESTAMP),
    };

    const result = createValidatedTrade(
      validBuy,
      createInitialLedgerData(),
      dependencies,
    );

    expect(result).toEqual({
      ok: false,
      kind: "service",
      error: {
        code: TRADE_SERVICE_ERROR_CODES.DEPENDENCY_FAILURE,
        operation: "generateId",
        message: expect.any(String),
      },
    });
    expect(dependencies.generateId).toHaveBeenCalledTimes(1);
    expect(dependencies.now).not.toHaveBeenCalled();
    expect(result).not.toHaveProperty("trade");
  });

  it("reports only a now dependency failure after obtaining a unique ID", () => {
    const dependencies: TradeServiceDependencies = {
      generateId: vi.fn(() => "unique-id"),
      now: vi.fn(() => {
        throw new Error("clock unavailable");
      }),
    };

    const result = createValidatedTrade(
      validBuy,
      createInitialLedgerData(),
      dependencies,
    );

    expect(result).toEqual({
      ok: false,
      kind: "service",
      error: {
        code: TRADE_SERVICE_ERROR_CODES.DEPENDENCY_FAILURE,
        operation: "now",
        message: expect.any(String),
      },
    });
    expect(dependencies.generateId).toHaveBeenCalledTimes(1);
    expect(dependencies.now).toHaveBeenCalledTimes(1);
    expect(result).not.toHaveProperty("trade");
  });
});

describe("createValidatedTrade immutability and downstream safety", () => {
  it("does not mutate input or ledger data on any result path", () => {
    const cases: Array<{
      name: string;
      input: unknown;
      ledgerData: LedgerData;
      dependencies: TradeServiceDependencies;
    }> = [
      {
        name: "success",
        input: { ...validBuy, note: "immutable" },
        ledgerData: createInitialLedgerData(),
        dependencies: createDependencies(["unique-id"]),
      },
      {
        name: "validation failure",
        input: { ...validBuy, assetSymbol: "DOGE" },
        ledgerData: createInitialLedgerData(),
        dependencies: createDependencies(["unused-id"]),
      },
      {
        name: "ID exhaustion",
        input: validBuy,
        ledgerData: createLedgerData({
          trades: [createSimpleTrade("collision", "buy", "BTC", "1")],
        }),
        dependencies: createDependencies([
          "collision",
          "collision",
          "collision",
        ]),
      },
      {
        name: "ID dependency failure",
        input: validBuy,
        ledgerData: createInitialLedgerData(),
        dependencies: {
          generateId: () => {
            throw new Error("ID failure");
          },
          now: () => TIMESTAMP,
        },
      },
      {
        name: "time dependency failure",
        input: validBuy,
        ledgerData: createInitialLedgerData(),
        dependencies: {
          generateId: () => "unique-id",
          now: () => {
            throw new Error("clock failure");
          },
        },
      },
    ];

    for (const testCase of cases) {
      const inputSnapshot = structuredClone(testCase.input);
      const ledgerSnapshot = structuredClone(testCase.ledgerData);
      const ledgerReference = testCase.ledgerData;
      const assetsReference = testCase.ledgerData.assets;
      const tradesReference = testCase.ledgerData.trades;
      const existingTradeReference = testCase.ledgerData.trades[0];

      deepFreeze(testCase.input);
      deepFreeze(testCase.ledgerData);

      expect(() =>
        createValidatedTrade(
          testCase.input,
          testCase.ledgerData,
          testCase.dependencies,
        ),
      ).not.toThrow();
      expect(testCase.input, testCase.name).toEqual(inputSnapshot);
      expect(testCase.ledgerData, testCase.name).toEqual(ledgerSnapshot);
      expect(testCase.ledgerData).toBe(ledgerReference);
      expect(testCase.ledgerData.assets).toBe(assetsReference);
      expect(testCase.ledgerData.trades).toBe(tradesReference);
      if (existingTradeReference) {
        expect(testCase.ledgerData.trades[0]).toBe(existingTradeReference);
      }
    }
  });

  it("returns a trade that positionService can safely calculate after append", () => {
    const ledgerData = createInitialLedgerData();
    const result = createValidatedTrade(
      validBuy,
      ledgerData,
      createDependencies(["trade-new"]),
    );

    expect(result.ok).toBe(true);
    if (!result.ok) {
      return;
    }

    const nextLedgerData: LedgerData = {
      ...ledgerData,
      trades: [...ledgerData.trades, result.trade],
    };

    expect(() => getPositionsFromLedger(nextLedgerData)).not.toThrow();
    expect(getPositionsFromLedger(nextLedgerData)[0]).toMatchObject({
      assetSymbol: "BTC",
      quantity: "0.001",
      currency: "USD",
    });
  });
});

function createLedgerData(
  overrides: Partial<LedgerData> = {},
): LedgerData {
  return {
    ...createInitialLedgerData(),
    ...overrides,
  };
}

function createSell(quantity: string, occurredAt: string): TradeDraft {
  return {
    occurredAt,
    timePrecision: "day",
    type: "sell",
    assetSymbol: "ADA",
    quantity,
    price: "1",
    totalValue: quantity,
    currency: "USD",
  };
}

function createDependencies(
  ids: string[],
): TradeServiceDependencies {
  let index = 0;

  return {
    generateId: vi.fn(() => ids[index++] ?? "unexpected-id"),
    now: vi.fn(() => TIMESTAMP),
  };
}

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
