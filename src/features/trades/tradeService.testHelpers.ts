import { vi } from "vitest";

import type {
  AssetTransfer,
  CustodyLocation,
  LedgerData,
  Trade,
  TradeDraft,
} from "@/core/models";
import { createInitialLedgerData } from "@/core/state";
import { createSimpleTrade } from "@/test-support";
import { type TradeServiceDependencies } from "./tradeService";

export const TIMESTAMP = "2026-07-14T12:00:00.000Z";

export const validBuy: TradeDraft = {
  occurredAt: "2026-07-14",
  timePrecision: "day",
  type: "buy",
  assetSymbol: "BTC",
  quantity: "0.001",
  price: "70000",
  totalValue: "70",
  currency: "USDT",
};

export function createLedgerData(
  overrides: Partial<LedgerData> = {},
): LedgerData {
  return {
    ...createInitialLedgerData(),
    ...overrides,
  };
}

export function createSell(quantity: string, occurredAt: string): TradeDraft {
  return {
    occurredAt,
    timePrecision: "day",
    type: "sell",
    assetSymbol: "ADA",
    quantity,
    price: "1",
    totalValue: quantity,
    currency: "USDT",
  };
}

export function btcSell(quantity: string): TradeDraft {
  return {
    occurredAt: "2026-04-02",
    timePrecision: "day",
    type: "sell",
    assetSymbol: "BTC",
    quantity,
    price: "1",
    totalValue: quantity,
    currency: "USDT",
  };
}

export function externalIn(
  id: string,
  toLocation: CustodyLocation,
): AssetTransfer {
  return {
    id,
    occurredAt: "2026-04-01",
    timePrecision: "day",
    assetSymbol: "BTC",
    quantity: "10",
    category: "external-in",
    reason: "deposit",
    unitPrice: "1",
    toLocation,
    createdAt: TIMESTAMP,
    updatedAt: TIMESTAMP,
  };
}

export function createUsdtTrade(
  id: string,
  type: "buy" | "sell",
  assetSymbol: string,
  quantity: string,
  occurredAt = "2026-04-01",
): Trade {
  return {
    ...createSimpleTrade(id, type, assetSymbol, quantity, occurredAt),
    currency: "USDT",
    feeCurrency: "USDT",
  };
}

export function createDependencies(
  ids: string[],
): TradeServiceDependencies {
  let index = 0;

  return {
    generateId: vi.fn(() => ids[index++] ?? "unexpected-id"),
    now: vi.fn(() => TIMESTAMP),
  };
}

export function deepFreeze<T>(value: T): T {
  if (typeof value !== "object" || value === null || Object.isFrozen(value)) {
    return value;
  }

  Object.freeze(value);
  for (const nestedValue of Object.values(value)) {
    deepFreeze(nestedValue);
  }

  return value;
}
