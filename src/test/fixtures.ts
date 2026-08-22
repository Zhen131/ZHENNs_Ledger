import type {
  Asset,
  PriceSnapshot,
  Trade,
  TradeDraft,
} from "../models";

const FIXTURE_TIMESTAMP = "2026-06-24T00:00:00Z";

export const sampleAssets: Asset[] = [
  createAsset("BTC", "Bitcoin"),
  createAsset("ETH", "Ethereum"),
  createAsset("ADA", "Cardano"),
];

/**
 * The single Week 2 golden input: four buys followed by one ADA sell.
 */
export const sampleTradeDrafts: TradeDraft[] = [
  {
    occurredAt: "2026-01-01",
    timePrecision: "day",
    type: "buy",
    assetSymbol: "BTC",
    quantity: "2",
    price: "10",
    totalValue: "20",
    currency: "USD",
    fee: "0",
    feeCurrency: "USD",
    rawText: "Fictional sample: buy 2 BTC at 10 USD.",
  },
  {
    occurredAt: "2026-01-02",
    timePrecision: "day",
    type: "buy",
    assetSymbol: "ETH",
    quantity: "3",
    price: "8",
    totalValue: "24",
    currency: "USD",
    fee: "0",
    feeCurrency: "USD",
    rawText: "Fictional sample: buy 3 ETH at 8 USD.",
  },
  {
    occurredAt: "2026-01-03",
    timePrecision: "day",
    type: "buy",
    assetSymbol: "ADA",
    quantity: "10",
    price: "2",
    totalValue: "20",
    currency: "USD",
    fee: "0",
    feeCurrency: "USD",
    rawText: "Fictional sample: buy 10 ADA at 2 USD.",
  },
  {
    occurredAt: "2026-01-04",
    timePrecision: "day",
    type: "buy",
    assetSymbol: "ADA",
    quantity: "20",
    price: "2",
    totalValue: "40",
    currency: "USD",
    fee: "0",
    feeCurrency: "USD",
    rawText: "Fictional sample: buy 20 ADA at 2 USD.",
  },
  {
    occurredAt: "2026-01-05",
    timePrecision: "day",
    type: "sell",
    assetSymbol: "ADA",
    quantity: "15",
    price: "4",
    totalValue: "60",
    currency: "USD",
    fee: "0",
    feeCurrency: "USD",
    rawText: "Fictional sample: sell 15 ADA at 4 USD.",
  },
];

export const sampleTrades: Trade[] = sampleTradeDrafts.map((draft, index) =>
  createTradeFromDraft(draft, `trade-${String(index + 1).padStart(3, "0")}`),
);

export function createAsset(symbol: string, name: string): Asset {
  return {
    id: `asset-${symbol.toLowerCase()}`,
    symbol,
    name,
    quoteCurrency: "USD",
    createdAt: FIXTURE_TIMESTAMP,
    updatedAt: FIXTURE_TIMESTAMP,
  };
}

export function createTradeFromDraft(draft: TradeDraft, id: string): Trade {
  return {
    ...draft,
    id,
    fee: draft.fee ?? "0",
    feeCurrency: draft.feeCurrency ?? draft.currency,
    createdAt: FIXTURE_TIMESTAMP,
    updatedAt: FIXTURE_TIMESTAMP,
  };
}

export function createSimpleTrade(
  id: string,
  type: "buy" | "sell",
  assetSymbol: string,
  quantity: string,
  occurredAt = "2026-04-01",
): Trade {
  return createTradeFromDraft(
    {
      occurredAt,
      timePrecision: "day",
      type,
      assetSymbol,
      quantity,
      price: "1",
      totalValue: quantity,
      currency: "USD",
      fee: "0",
      feeCurrency: "USD",
    },
    id,
  );
}

export function createPriceSnapshot(
  id: string,
  assetSymbol: string,
  price: string,
  recordedAt: string,
  currency = "USD",
): PriceSnapshot {
  return {
    id,
    assetSymbol,
    price,
    currency,
    recordedAt,
    source: "manual",
    createdAt: FIXTURE_TIMESTAMP,
    updatedAt: FIXTURE_TIMESTAMP,
  };
}
