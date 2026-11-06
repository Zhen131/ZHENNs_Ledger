/**
 * 这个文件放测试共用的虚构样例。
 * 里面有三种币，五笔买卖，几个造数据的小函数。
 * 黄金样例文件不在这里，在仓库的 `test-fixtures/golden/` 里。
 * 不显然的决定：样例一律用 USDT 计价，手续费都是 0。
 */
import type {
  Asset,
  PriceSnapshot,
  Trade,
  TradeDraft,
} from "@/core/models";

/** 样例里所有创建、更新时刻共用的固定时间，2026-06-24 零点。 */
const FIXTURE_TIMESTAMP = "2026-06-24T00:00:00Z";

/** 三种样例币：BTC、ETH、ADA。都用 USDT 计价，没配交易所。 */
export const sampleAssets: Asset[] = [
  createAsset("BTC", "Bitcoin"),
  createAsset("ETH", "Ethereum"),
  createAsset("ADA", "Cardano"),
];

/**
 * 五笔虚构买卖的草稿，2026-01-01 到 01-05 每天一笔。
 * 前四笔是买：2 BTC、3 ETH、10 ADA、20 ADA。
 * 第五笔卖出 15 ADA，成交 60 USDT。
 * 全部用 USDT，手续费 0。给算持仓、算成本的测试用。
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

/** 上面五笔草稿配上编号 trade-001 到 trade-005 后的正式交易。 */
export const sampleTrades: Trade[] = sampleTradeDrafts.map((draft, index) =>
  createTradeFromDraft(draft, `trade-${String(index + 1).padStart(3, "0")}`),
);

/** 和 `sampleTrades` 一样的五笔交易，另拷一份，改它不影响原来那份。 */
export const sampleUsdtTrades: Trade[] = structuredClone(sampleTrades);

/**
 * 这个函数造一个测试用的资产，编号是 asset- 加小写代号。
 * 举例：代号 BTC、名字 Bitcoin → 答编号 asset-btc 的 BTC。
 * 计价币种固定 USDT。不会出错。
 */
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

/**
 * 这个函数造一个 USDT 计价的测试资产。
 * 现在 `createAsset` 本来就是 USDT，两者结果一样。
 * 不会出错。
 */
export function createUsdtAsset(symbol: string, name: string): Asset {
  return { ...createAsset(symbol, name), quoteCurrency: "USDT" };
}

/**
 * 这个函数把交易草稿配上编号和固定时刻，变成交易。
 * 没填手续费当 0；没填手续费币种，就用成交币种。
 * 举例：买 0.1 BTC，成交 6500 USDT，手续费 5 → 答同样数字的交易。
 * 草稿的成交币种不是 USDT 时抛错。
 */
export function createTradeFromDraft(draft: TradeDraft, id: string): Trade {
  if (draft.currency !== "USDT") {
    throw new Error("V4 trade fixtures must use USDT");
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

/**
 * 这个函数造一笔单价 1 USDT 的简单买卖，成交金额等于数量。
 * 日期默认 2026-04-01，手续费 0。
 * 举例：买 2 BTC → 答单价 1、成交 2 USDT 的买入。
 * 不会出错。
 */
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

/**
 * 这个函数和 `createSimpleTrade` 一样。
 * 它再把成交币种和手续费币种写明成 USDT。
 * 举例：卖 1 ADA → 答单价 1、成交 1 USDT 的卖出。
 * 不会出错。
 */
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

/**
 * 这个函数造一条手动记下的价格。
 * 计价币种默认 USDT，来源固定是手动。
 * 举例：BTC、65000、2026-04-02 → 答那天 BTC 价 65000 USDT。
 * 不会出错。
 */
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

/**
 * 这个函数造一条 USDT 计价的手动价格。
 * 它就是 `createPriceSnapshot` 把币种写死。
 * 举例：ETH 记 3000 → 答一条 3000 USDT 的价格。
 * 不会出错。
 */
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
