export type DecimalString = string;

export type CurrencyCode = string;
export type ISODateString = string;
export type ISODateTimeString = string;

export type TimePrecision = "day" | "minute" | "second";
export type TradeType = "buy" | "sell";
export type PriceSource = "manual" | "api";
export type FeeRuleType = "fixed" | "percentage";
export type FeeRuleStatus = "active" | "inactive";
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
  quoteCurrency: "USDT";
  decimals?: number;
  binanceMapping: BinanceMarketMapping | null;
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
  currency: "USDT";
  fee: DecimalString;
  feeCurrency: CurrencyCode;
  platform?: string;
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
  platform?: string;
  feeRuleId?: string;
  note?: string;
  rawText?: string;
};

export type PriceSnapshot = {
  id: string;
  assetSymbol: string;
  price: DecimalString;
  currency: "USDT";
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

export type FeeRuleBase = {
  id: string;
  name: string;
  platform: string;
  assetSymbol: string;
  status: FeeRuleStatus;
  createdAt: ISODateTimeString;
  updatedAt: ISODateTimeString;
  deactivatedAt?: ISODateTimeString;
  replacesFeeRuleId?: string;
};

export type FixedFeeRule = FeeRuleBase & {
  type: "fixed";
  amount: DecimalString;
  currency: "USDT";
};

export type PercentageFeeRule = FeeRuleBase & {
  type: "percentage";
  rate: DecimalString;
  currency: "USDT";
};

export type FeeRule = FixedFeeRule | PercentageFeeRule;

export type CashEventType =
  | "deposit"
  | "withdrawal"
  | "external-expense"
  | "balance-adjustment";

export type CashEventBase = {
  id: string;
  occurredAt: ISODateString | ISODateTimeString;
  timePrecision: TimePrecision;
  currency: "USDT";
  note?: string;
  createdAt: ISODateTimeString;
  updatedAt: ISODateTimeString;
};

export type CashFlowEvent = CashEventBase & {
  type: "deposit" | "withdrawal" | "external-expense";
  amount: DecimalString;
};

export type CashBalanceAdjustmentEvent = CashEventBase & {
  type: "balance-adjustment";
  balanceBefore: DecimalString;
  targetBalance: DecimalString;
  adjustmentAmount: DecimalString;
};

export type CashEvent = CashFlowEvent | CashBalanceAdjustmentEvent;

export type FeeAccountingIssue = {
  code: "UNSUPPORTED_FEE_CURRENCY";
  tradeId: string;
  assetSymbol: string;
  occurredAt: ISODateString | ISODateTimeString;
  fee: DecimalString;
  feeCurrency: CurrencyCode;
  tradeCurrency: CurrencyCode;
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
  feeAccountingIssues?: readonly FeeAccountingIssue[];
};

export type LedgerData = {
  schemaVersion: 3;
  assets: Asset[];
  trades: Trade[];
  cashEvents: CashEvent[];
  priceSnapshots: PriceSnapshot[];
  feeRules: FeeRule[];
};
