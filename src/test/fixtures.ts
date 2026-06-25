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
 * Week 2 唯一 golden 输入：4 条买入 + 第 5 条 ADA 卖出。
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
    rawText: "以均价 67121.7 买入 BTC 0.00016388 个，价值 11 USD，26/04/02",
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
    rawText: "以均价 2059.99 买入 ETH 0.004854 个，价值 10 USD，26/04/02",
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
    rawText: "以均价 0.2405 买入 ADA 41.58 个，价值 10 USD，26/04/02",
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
    rawText: "以均价 0.2526 买入 ADA 126.6825 个，价值 32 USD，26/04/09",
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
    rawText: "以均价 0.2412 卖出 ADA 82.9381 个，价值 20 USD，26/04/14",
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
