import { describe, expect, it } from "vitest";

import type { LedgerData } from "@/core/models";
import { createInitialLedgerData } from "@/core/state";
import {
  TRADE_VALIDATION_ERROR_CODES,
  validateTradeDraft,
} from "@/core/validation";
import { createValidatedTrade } from "./tradeService";
import {
  validBuy,
  createLedgerData,
  createSell,
  createUsdtTrade,
  createDependencies,
} from "./tradeService.testHelpers";

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
          createUsdtTrade("buy-ada", "buy", "ADA", "10", "2026-04-01"),
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
          createUsdtTrade("future-buy", "buy", "ADA", "10", "2026-04-10"),
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
          createUsdtTrade("buy-ada", "buy", "ADA", "10", "2026-04-01"),
          createUsdtTrade("sell-ada", "sell", "ADA", "10", "2026-04-03"),
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
            ...createUsdtTrade("buy-btc", "buy", "BTC", "1"),
            currency: "CNY" as never,
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
        todayKey: "2026-07-25",
        requireSupportedValuationCurrency: true,
        requiredCurrency: "USDT",
        requireFeeCurrencyMatch: true,
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
