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
    occurredAt: "2026-04-02",
    timePrecision: "day",
    type: "buy",
    assetSymbol: "BTC",
    quantity: "0.00016388",
    price: "67121.7",
    totalValue: "11",
    currency: "USD",
    fee: "0",
    feeCurrency: "USD",
    rawText: "Buy 0.00016388 BTC at an average price of 67121.7, worth 11 USD, 26/04/02",
  },
  {
    occurredAt: "2026-04-02",
    timePrecision: "day",
    type: "buy",
    assetSymbol: "ETH",
    quantity: "0.004854",
    price: "2059.99",
    totalValue: "10",
    currency: "USD",
    fee: "0",
    feeCurrency: "USD",
    rawText: "Buy 0.004854 ETH at an average price of 2059.99, worth 10 USD, 26/04/02",
  },
  {
    occurredAt: "2026-04-02",
    timePrecision: "day",
    type: "buy",
    assetSymbol: "ADA",
    quantity: "41.58",
    price: "0.2405",
    totalValue: "10",
    currency: "USD",
    fee: "0",
    feeCurrency: "USD",
    rawText: "Buy 41.58 ADA at an average price of 0.2405, worth 10 USD, 26/04/02",
  },
  {
    occurredAt: "2026-04-09",
    timePrecision: "day",
    type: "buy",
    assetSymbol: "ADA",
    quantity: "126.6825",
    price: "0.2526",
    totalValue: "32",
    currency: "USD",
    fee: "0",
    feeCurrency: "USD",
    rawText: "Buy 126.6825 ADA at an average price of 0.2526, worth 32 USD, 26/04/09",
  },
  {
    occurredAt: "2026-04-14",
    timePrecision: "day",
    type: "sell",
    assetSymbol: "ADA",
    quantity: "82.9381",
    price: "0.2412",
    totalValue: "20",
    currency: "USD",
    fee: "0",
    feeCurrency: "USD",
    rawText: "Sell 82.9381 ADA at an average price of 0.2412, worth 20 USD, 26/04/14",
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
