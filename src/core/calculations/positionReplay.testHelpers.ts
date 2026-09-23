import type { AssetTransfer, Trade } from "@/core/models";

export const TIMESTAMP = "2026-08-09T00:00:00Z";

export function trade(
  overrides: Pick<
    Trade,
    | "id"
    | "occurredAt"
    | "type"
    | "quantity"
    | "price"
    | "totalValue"
    | "fee"
  > &
    Partial<Pick<Trade, "feeCurrency" | "feeRuleId">>,
): Trade {
  return {
    timePrecision: "day",
    assetSymbol: "BTC",
    currency: "USDT",
    feeCurrency: overrides.feeCurrency ?? "USDT",
    createdAt: TIMESTAMP,
    updatedAt: TIMESTAMP,
    ...overrides,
  };
}

export function baseBuy(): Trade {
  return trade({
    id: "base-buy",
    occurredAt: "2026-08-01",
    type: "buy",
    quantity: "100",
    price: "10",
    totalValue: "1000",
    fee: "0",
  });
}

export function transfer(
  overrides: Pick<
    AssetTransfer,
    "id" | "occurredAt" | "category" | "reason" | "quantity"
  > &
    Partial<
      Pick<
        AssetTransfer,
        | "unitPrice"
        | "networkFee"
        | "fromLocation"
        | "toLocation"
        | "createdAt"
      >
    >,
): AssetTransfer {
  return {
    timePrecision: overrides.occurredAt.includes("T") ? "second" : "day",
    assetSymbol: "BTC",
    createdAt: overrides.createdAt ?? TIMESTAMP,
    updatedAt: overrides.createdAt ?? TIMESTAMP,
    ...overrides,
  };
}
