import { describe, expect, it } from "vitest";

import type { LedgerData } from "@/core/models";
import { createInitialLedgerData } from "@/core/state";
import { getPositionsFromLedger } from "@/features/portfolio";
import {
  createValidatedTrade,
  type TradeServiceDependencies,
} from "./tradeService";
import {
  TIMESTAMP,
  validBuy,
  createLedgerData,
  createUsdtTrade,
  createDependencies,
  deepFreeze,
} from "./tradeService.testHelpers";

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
          trades: [createUsdtTrade("collision", "buy", "BTC", "1")],
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
      currency: "USDT",
    });
  });
});
