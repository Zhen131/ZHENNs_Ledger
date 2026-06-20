export type DecimalString = string;

export type CurrencyCode = string;
export type ISODateString = string;
export type ISODateTimeString = string;

export type TimePrecision = "day" | "minute" | "second";
export type TradeType = "buy" | "sell";
export type PriceSource = "manual" | "api";
export type FeeRuleType = "percentage";

export type Asset = {
  id: string;
  symbol: string;
  name: string;
  quoteCurrency: CurrencyCode;
  decimals?: number;
  createdAt: ISODateTimeString;
  updatedAt: ISODateTimeString;
};

export type Trade = {
  id: string;
  occurredAt: ISODateString | ISODateTimeString;
  timePrecision: TimePrecision;
  type: TradeType;
  assetSymbol: string;
  quantity: DecimalString;
  quantitySortKey?: DecimalString;
  price: DecimalString;
  totalValue: DecimalString;
  totalValueSortKey?: DecimalString;
  currency: CurrencyCode;
  fee: DecimalString;
  feeCurrency: CurrencyCode;
  feeRuleId?: string;
  note?: string;
  rawText?: string;
  createdAt: ISODateTimeString;
  updatedAt: ISODateTimeString;
};

export type TradeDraft = {
  occurredAt: ISODateString | ISODateTimeString;
  timePrecision: TimePrecision;
  type: TradeType;
  assetSymbol: string;
  quantity: DecimalString;
  price: DecimalString;
  totalValue: DecimalString;
  currency: CurrencyCode;
  fee?: DecimalString;
  feeCurrency?: CurrencyCode;
  feeRuleId?: string;
  note?: string;
  rawText?: string;
};

export type PriceSnapshot = {
  id: string;
  assetSymbol: string;
  price: DecimalString;
  currency: CurrencyCode;
  recordedAt: ISODateString | ISODateTimeString;
  source: PriceSource;
  note?: string;
  createdAt: ISODateTimeString;
  updatedAt: ISODateTimeString;
};

export type FeeRule = {
  id: string;
  name: string;
  platform: string;
  type: FeeRuleType;
  rate: DecimalString;
  currency: CurrencyCode;
  createdAt: ISODateTimeString;
  updatedAt: ISODateTimeString;
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
  currency: CurrencyCode;
};

export type LedgerData = {
  schemaVersion: 1;
  assets: Asset[];
  trades: Trade[];
  priceSnapshots: PriceSnapshot[];
  feeRules: FeeRule[];
};
