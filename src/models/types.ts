export type DecimalString = string;

export type CurrencyCode = string;
export type ISODateString = string;
export type ISODateTimeString = string;

export type TimePrecision = "day" | "minute" | "second";
export type TradeType = "buy" | "sell";
export type PriceSource = "manual" | "api";
export type FeeRuleType = "percentage";
export type ValuationPriceMode = "auto" | "manual";

export type BinanceMarketMapping = {
  provider: "binance";
  symbol: string;
  baseAsset: string;
  quoteAsset: "USDT";
};

export type BinancePriceProvenance = {
  provider: "binance";
  symbol: string;
  sourceQuoteCurrency: "USDT";
  fetchedAt: ISODateTimeString;
};

export type Asset = {
  id: string;
  symbol: string;
  name: string;
  quoteCurrency: CurrencyCode;
  decimals?: number;
  binanceMapping?: BinanceMarketMapping | null;
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
  /** Executed quantity times average price, excluding fees. */
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
  /** Executed quantity times average price, excluding fees. */
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
  binanceProvenance?: BinancePriceProvenance;
  note?: string;
  createdAt: ISODateTimeString;
  updatedAt: ISODateTimeString;
};

export type PriceSnapshotDraft = {
  assetSymbol: string;
  price: DecimalString;
  currency: CurrencyCode;
  recordedAt: ISODateString | ISODateTimeString;
  source: PriceSource;
  binanceProvenance?: BinancePriceProvenance;
  note?: string;
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
