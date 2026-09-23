import { describe, expect, it, vi } from "vitest";
import { createInitialLedgerData } from "@/core/state";
import {
  TRADE_SERVICE_ERROR_CODES,
  createValidatedTrade,
  type TradeServiceDependencies,
} from "./tradeService";
import {
  TIMESTAMP,
  validBuy,
  createLedgerData,
  createUsdtTrade,
  createDependencies,
} from "./tradeService.testHelpers";

describe("createValidatedTrade ID and dependency handling", () => {
  it("treats cross-collection IDs and invalid candidates as collisions", () => {
    const ledgerData = createInitialLedgerData();
    ledgerData.cashEvents = [
      {
        id: "cross-collection-id",
        occurredAt: "2026-07-01",
        timePrecision: "day",
        type: "deposit",
        currency: "USDT",
        amount: "1",
        createdAt: TIMESTAMP,
        updatedAt: TIMESTAMP,
      },
    ];
    const dependencies = createDependencies([
      "cross-collection-id",
      " invalid-id ",
      "trade-new",
    ]);

    const result = createValidatedTrade(validBuy, ledgerData, dependencies);

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.trade.id).toBe("trade-new");
    }
    expect(dependencies.generateId).toHaveBeenCalledTimes(3);
    expect(dependencies.now).toHaveBeenCalledTimes(1);
  });

  it("retries one collision and stops after the second ID succeeds", () => {
    const ledgerData = createLedgerData({
      trades: [createUsdtTrade("existing-id", "buy", "BTC", "1")],
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
        createUsdtTrade("collision-1", "buy", "BTC", "1"),
        createUsdtTrade("collision-2", "buy", "BTC", "1"),
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
      trades: [createUsdtTrade("collision", "buy", "BTC", "1")],
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
