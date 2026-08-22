import type {
  Asset,
  PriceSnapshot,
  Trade,
  TradeDraft,
} from "@/core/models";

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
    occurredAt: "2026-01-01",
    timePrecision: "day",
    type: "buy",
    assetSymbol: "BTC",
    quantity: "2",
    price: "10",
    totalValue: "20",
    currency: "USDT",
    fee: "0",
    feeCurrency: "USDT",
    rawText: "虚构样例：以 10 USDT 买入 2 BTC。",
  },
  {
    occurredAt: "2026-01-02",
    timePrecision: "day",
    type: "buy",
    assetSymbol: "ETH",
    quantity: "3",
    price: "8",
    totalValue: "24",
    currency: "USDT",
    fee: "0",
    feeCurrency: "USDT",
    rawText: "虚构样例：以 8 USDT 买入 3 ETH。",
  },
  {
    occurredAt: "2026-01-03",
    timePrecision: "day",
    type: "buy",
    assetSymbol: "ADA",
    quantity: "10",
    price: "2",
    totalValue: "20",
    currency: "USDT",
    fee: "0",
    feeCurrency: "USDT",
    rawText: "虚构样例：以 2 USDT 买入 10 ADA。",
  },
  {
    occurredAt: "2026-01-04",
    timePrecision: "day",
    type: "buy",
    assetSymbol: "ADA",
    quantity: "20",
    price: "2",
    totalValue: "40",
    currency: "USDT",
    fee: "0",
    feeCurrency: "USDT",
    rawText: "虚构样例：以 2 USDT 买入 20 ADA。",
  },
  {
    occurredAt: "2026-01-05",
    timePrecision: "day",
    type: "sell",
    assetSymbol: "ADA",
    quantity: "15",
    price: "4",
    totalValue: "60",
    currency: "USDT",
    fee: "0",
    feeCurrency: "USDT",
    rawText: "虚构样例：以 4 USDT 卖出 15 ADA。",
  },
];

export const sampleTrades: Trade[] = sampleTradeDrafts.map((draft, index) =>
  createTradeFromDraft(draft, `trade-${String(index + 1).padStart(3, "0")}`),
);

export const sampleUsdtTrades: Trade[] = structuredClone(sampleTrades);

export function createAsset(symbol: string, name: string): Asset {
  return {
    id: `asset-${symbol.toLowerCase()}`,
    symbol,
    name,
    quoteCurrency: "USDT",
    binanceMapping: null,
    createdAt: FIXTURE_TIMESTAMP,
    updatedAt: FIXTURE_TIMESTAMP,
  };
}

export function createUsdtAsset(symbol: string, name: string): Asset {
  return { ...createAsset(symbol, name), quoteCurrency: "USDT" };
}

export function createTradeFromDraft(draft: TradeDraft, id: string): Trade {
  if (draft.currency !== "USDT") {
    throw new Error("V3 trade fixtures must use USDT");
  }
  const currency: "USDT" = draft.currency;

  return {
    ...draft,
    currency,
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
      currency: "USDT",
      fee: "0",
      feeCurrency: "USDT",
    },
    id,
  );
}

export function createUsdtSimpleTrade(
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

export function createPriceSnapshot(
  id: string,
  assetSymbol: string,
  price: string,
  recordedAt: string,
  currency: PriceSnapshot["currency"] = "USDT",
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

export function createUsdtPriceSnapshot(
  id: string,
  assetSymbol: string,
  price: string,
  recordedAt: string,
): PriceSnapshot {
  return createPriceSnapshot(
    id,
    assetSymbol,
    price,
    recordedAt,
    "USDT",
  );
}
