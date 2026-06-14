export type DecimalString = string;

export type TimePrecision = "day" | "minute" | "second";

export type TradeType = "buy" | "sell";

export type Asset = {
  id: string;
  symbol: string;
  name: string;
  quoteCurrency: string;
  createdAt: string;
  updatedAt: string;
};

export type Trade = {
  id: string;
  occurredAt: string;
  timePrecision: TimePrecision;
  type: TradeType;
  assetSymbol: string;
  quantity: DecimalString;
  price: DecimalString;
  totalValue: DecimalString;
  currency: string;
  fee: DecimalString;
  feeCurrency: string;
  feeRuleId?: string;
  note?: string;
  rawText?: string;
  createdAt: string;
  updatedAt: string;
};

export type PriceSnapshot = {
  id: string;
  assetSymbol: string;
  price: DecimalString;
  currency: string;
  recordedAt: string;
  source: "manual" | "api";
  note?: string;
  createdAt: string;
  updatedAt: string;
};

export type FeeRule = {
  id: string;
  name: string;
  platform: string;
  type: "percentage";
  rate: DecimalString;
  currency: string;
  createdAt: string;
  updatedAt: string;
};

export type Position = {
  assetSymbol: string;
  quantity: DecimalString;
  averageCost: DecimalString;
  costBasis: DecimalString;
  latestPrice?: DecimalString;
  marketValue?: DecimalString;
  realizedPnl: DecimalString;
  unrealizedPnl?: DecimalString;
  currency: string;
};

export type LedgerData = {
  schemaVersion: 1;
  assets: Asset[];
  trades: Trade[];
  priceSnapshots: PriceSnapshot[];
  feeRules: FeeRule[];
};
