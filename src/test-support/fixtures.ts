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
    occurredAt: "2026-04-02",
    timePrecision: "day",
    type: "buy",
    assetSymbol: "BTC",
    quantity: "0.24265306",
    price: "67121.7",
    totalValue: "11",
    currency: "USDT",
    fee: "0",
    feeCurrency: "USDT",
    rawText: "Fictional legacy sample with private values removed.",
  },
  {
    occurredAt: "2026-04-02",
    timePrecision: "day",
    type: "buy",
    assetSymbol: "ETH",
    quantity: "0.400040",
    price: "2059.99",
    totalValue: "10",
    currency: "USDT",
    fee: "0",
    feeCurrency: "USDT",
    rawText: "Fictional legacy sample with private values removed.",
  },
  {
    occurredAt: "2026-04-02",
    timePrecision: "day",
    type: "buy",
    assetSymbol: "ADA",
    quantity: "41.58",
    price: "0.2405",
    totalValue: "10",
    currency: "USDT",
    fee: "0",
    feeCurrency: "USDT",
    rawText: "Fictional legacy sample with private values removed.",
  },
  {
    occurredAt: "2026-04-09",
    timePrecision: "day",
    type: "buy",
    assetSymbol: "ADA",
    quantity: "126.6825",
    price: "0.2526",
    totalValue: "32",
    currency: "USDT",
    fee: "0",
    feeCurrency: "USDT",
    rawText: "Fictional legacy sample with private values removed.",
  },
  {
    occurredAt: "2026-04-14",
    timePrecision: "day",
    type: "sell",
    assetSymbol: "ADA",
    quantity: "82.9381",
    price: "0.2412",
    totalValue: "20",
    currency: "USDT",
    fee: "0",
    feeCurrency: "USDT",
    rawText: "Fictional legacy sample with private values removed.",
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
