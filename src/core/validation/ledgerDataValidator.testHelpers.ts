import { expect } from "vitest";

import type {
  AssetTransfer,
  AssetTransferCategory,
  LedgerData,
} from "@/core/models";
import { createInitialLedgerData } from "@/core/state";
import { createPriceSnapshot, sampleTrades } from "@/test-support";
import { validateLedgerData } from "./ledgerDataValidator";

export function createCompleteLedger(): LedgerData {
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

export function expectError(
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

export function cashFlow(
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

export function transferForCategory(
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

export function withoutTransferField(
  transfer: AssetTransfer,
  field: "fromLocation" | "toLocation" | "unitPrice",
): Record<string, unknown> {
  const value: Record<string, unknown> = { ...transfer };
  Reflect.deleteProperty(value, field);
  return value;
}

export function ledgerWithTransfer(transfer: unknown): unknown {
  return {
    ...createInitialLedgerData(),
    assetTransfers: [transfer],
  };
}
