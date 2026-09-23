import type { DecimalString } from "@/core/models";
import { type ValuationDisplay } from "@/features/portfolio";

export type HoldingAllocationGroupedMember = {
  assetSymbol: string;
  marketValue: DecimalString;
};

export type HoldingAllocationSlice = {
  assetSymbol: string;
  marketValue: DecimalString;
  ratio: DecimalString;
  source: "manual" | "binance" | "cash" | "grouped";
  asOf: string;
  groupedMembers?: HoldingAllocationGroupedMember[];
};

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

export type ChartRange = "1d" | "7d" | "30d" | "365d" | "all";

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

export type TradeHeatmapDay = {
  date: string;
  total: number;
  buys: number;
  sells: number;
  level: 0 | 1 | 2 | 3 | 4;
  activityGroups: TradeHeatmapActivityGroup[];
};

export type TradeHeatmapActivityGroup = {
  assetSymbol: string;
  type: "buy" | "sell";
  count: number;
};
