/**
 * 这个文件放三张图要用的数据形状。
 * 三张图是持仓分配、资产走势、交易热力图。
 * 数据怎么算在旁边三个 `chartDataService*.ts`，图怎么画在 `chartOptionBuilders.ts`。
 * 没有特别的决定。
 */
import type { DecimalString } from "@/core/models";
import { type ValuationDisplay } from "@/features/portfolio";

/** 并进「其他」那一块的一种币：代码和市值。 */
export type HoldingAllocationGroupedMember = {
  assetSymbol: string;
  marketValue: DecimalString;
};

/**
 * 分配图上的一块：哪种币、市值、占比。
 * 还有价格来源和算到哪天。
 * 来源是 `grouped` 时，`groupedMembers` 列出并进来的币。
 */
export type HoldingAllocationSlice = {
  assetSymbol: string;
  marketValue: DecimalString;
  ratio: DecimalString;
  source: "manual" | "binance" | "cash" | "grouped";
  asOf: string;
  groupedMembers?: HoldingAllocationGroupedMember[];
};

/**
 * 分配图要的全部数据：每一块、币的市值、现金。
 * 还有缺口和总资产。
 * 还有缺价格和不用 USDT 计价的币，以及计价单位写法。
 */
export type HoldingAllocation = {
  slices: HoldingAllocationSlice[];
  assetMarketValue: DecimalString;
  cashBalance: DecimalString;
  cashDeficit: DecimalString;
  totalMarketValue: DecimalString;
  missingPriceAssets: string[];
  excludedCurrencyAssets: string[];
  valuation: ValuationDisplay;
};

/** 走势图能选的时间范围：1 天、7 天、30 天、365 天、全部。 */
export type ChartRange = "1d" | "7d" | "30d" | "365d" | "all";

/**
 * 走势图上的一个点：哪天、总资产、剩余成本。
 * 还有币的市值和现金。
 * 缺价格或成本算不准时，对应的总数不给，并列出是哪些币。
 * `displayBoundary` 只在「1 天」时用，标出这一天的头和尾。
 */
export type HoldingHistoryPoint = {
  date: string;
  totalCostBasis?: DecimalString;
  totalMarketValue?: DecimalString;
  assetMarketValue: DecimalString;
  cashBalance: DecimalString;
  cashDeficit: DecimalString;
  missingPriceAssets: string[];
  excludedCurrencyAssets: string[];
  unreliableFeeAssets: string[];
  priceAsOfByAsset: Record<string, string>;
  valuation: ValuationDisplay;
  displayBoundary?: "start" | "end";
};

/**
 * 热力图上的一天：一共几笔、买几笔、卖几笔。
 * 颜色深浅分 0～4 级。
 * 还按币和买卖分组记了笔数。
 */
export type TradeHeatmapDay = {
  date: string;
  total: number;
  buys: number;
  sells: number;
  level: 0 | 1 | 2 | 3 | 4;
  activityGroups: TradeHeatmapActivityGroup[];
};

/** 某一天里，某种币的买或卖一共几笔。 */
export type TradeHeatmapActivityGroup = {
  assetSymbol: string;
  type: "buy" | "sell";
  count: number;
};
