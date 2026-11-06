/**
 * 这个文件管账本里每样东西长什么样。
 * 资产、交易、价格、现金、转移、手续费规则都在这里。
 * 它只定形状，不检查对不对（那在 validation 区），也不算钱（那在 calculations 区）。
 * 不显然的决定：金额和数量一律存成数字文字，不存 number，2026-08-10 定（W12 02A 第 5.1 节）。
 */

/** 存成文字的精确小数，例如 "6500.5"。金额和数量都用它。 */
export type DecimalString = string;

/** 币种代码，例如 "USDT"、"BTC"。 */
export type CurrencyCode = string;
/** 只有日期的文字，例如 "2026-08-20"。 */
export type ISODateString = string;
/** 带时刻和时差的文字，例如 "2026-08-20T05:40:32+08:00"。 */
export type ISODateTimeString = string;

/** 一笔记录记到多细：只到天、到分钟、到秒。 */
export type TimePrecision = "day" | "minute" | "second";
/** 买卖方向：买入或卖出。 */
export type TradeType = "buy" | "sell";
/** 价格从哪来：手动填的，或从行情接口取的。 */
export type PriceSource = "manual" | "api";
/** 手续费规则在不在用：在用或已停用。 */
export type FeeRuleStatus = "active" | "inactive";
/** 估值用哪种价格：自动取最新的，或用手动填的。 */
export type ValuationPriceMode = "auto" | "manual";

/**
 * 资产转移的大类。
 * 分四种：内部挪动、从外面转进、转出去、白得的收益。
 */
export type AssetTransferCategory =
  | "internal"
  | "external-in"
  | "external-out"
  | "gain";

/**
 * 资产转移的具体原因。
 * 分六种：充值、提币、内部挪动、空投、利息、平台赠送。
 */
export type AssetTransferReason =
  | "deposit"
  | "withdrawal"
  | "internal-move"
  | "airdrop"
  | "interest"
  | "platform-gift";

/** 币放在哪：交易所、冷钱包、冷钱包理财。 */
export type CustodyLocation =
  | "exchange"
  | "cold-wallet"
  | "cold-wallet-earn";

/** 一个资产对应的 Binance 交易对，例如 BTC 对应 BTCUSDT。只用来联网取价格。 */
export type BinanceMarketMapping = {
  provider: "binance";
  symbol: string;
  baseAsset: string;
  quoteAsset: "USDT";
};

/** 从 Binance 取来的价格的来历：哪个交易对、什么时候取的。 */
export type BinancePriceProvenance = {
  provider: "binance";
  symbol: string;
  sourceQuoteCurrency: "USDT";
  fetchedAt: ISODateTimeString;
};

/** 账本里的一种资产，例如 BTC。有没有 Binance 交易对都能记账。 */
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

/** 存进账本的一笔买卖。 */
export type Trade = {
  id: string;
  occurredAt: ISODateString | ISODateTimeString;
  occurredTimeZone?: string;
  timePrecision: TimePrecision;
  type: TradeType;
  assetSymbol: string;
  quantity: DecimalString;
  quantitySortKey?: DecimalString;
  price: DecimalString;
  /** 成交金额：数量乘成交均价，不含手续费。 */
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

/** 表单上还没存的一笔买卖，检查通过后才变成 Trade。 */
export type TradeDraft = {
  occurredAt: ISODateString | ISODateTimeString;
  occurredTimeZone?: string;
  timePrecision: TimePrecision;
  type: TradeType;
  assetSymbol: string;
  quantity: DecimalString;
  price: DecimalString;
  /** 成交金额：数量乘成交均价，不含手续费。 */
  totalValue: DecimalString;
  currency: CurrencyCode;
  fee?: DecimalString;
  feeCurrency?: CurrencyCode;
  platform?: string;
  feeRuleId?: string;
  note?: string;
  rawText?: string;
};

/**
 * 存进账本的一条记下来的价格。
 * 记的是哪个资产、多少钱、哪天记的。
 */
export type PriceSnapshot = {
  id: string;
  assetSymbol: string;
  price: DecimalString;
  currency: "USDT";
  recordedAt: ISODateString | ISODateTimeString;
  occurredTimeZone?: string;
  source: PriceSource;
  binanceProvenance?: BinancePriceProvenance;
  note?: string;
  createdAt: ISODateTimeString;
  updatedAt: ISODateTimeString;
};

/** 表单上还没存的一条价格，检查通过后才存进账本。 */
export type PriceSnapshotDraft = {
  assetSymbol: string;
  price: DecimalString;
  currency: CurrencyCode;
  recordedAt: ISODateString | ISODateTimeString;
  occurredTimeZone?: string;
  source: PriceSource;
  binanceProvenance?: BinancePriceProvenance;
  note?: string;
};

/** 手续费规则共有的部分：哪个平台、哪个资产、在不在用。 */
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

/** 固定金额的手续费规则，例如每笔 1 USDT。 */
export type FixedFeeRule = FeeRuleBase & {
  type: "fixed";
  amount: DecimalString;
  currency: "USDT";
};

/** 按比例的手续费规则，例如 0.001 就是成交金额的千分之一。 */
export type PercentageFeeRule = FeeRuleBase & {
  type: "percentage";
  rate: DecimalString;
  currency: "USDT";
};

/** 一条手续费规则：固定金额或按比例。只给表单当建议，不直接算进账。 */
export type FeeRule = FixedFeeRule | PercentageFeeRule;

/** 现金记录的四种：入金、出金、外部支出、余额校准。 */
export type CashEventType =
  | "deposit"
  | "withdrawal"
  | "external-expense"
  | "balance-adjustment";

/** 现金记录共有的部分：时间、地点、币种（只有 USDT）。 */
export type CashEventBase = {
  id: string;
  occurredAt: ISODateString | ISODateTimeString;
  occurredTimeZone?: string;
  timePrecision: TimePrecision;
  currency: "USDT";
  note?: string;
  createdAt: ISODateTimeString;
  updatedAt: ISODateTimeString;
};

/** 入金、出金或外部支出，金额总是正数。 */
export type CashFlowEvent = CashEventBase & {
  type: "deposit" | "withdrawal" | "external-expense";
  amount: DecimalString;
};

/** 余额校准：校准前余额、目标余额、差额三个数。 */
export type CashBalanceAdjustmentEvent = CashEventBase & {
  type: "balance-adjustment";
  balanceBefore: DecimalString;
  targetBalance: DecimalString;
  adjustmentAmount: DecimalString;
};

/** 一条现金记录：钱进出，或者余额校准。 */
export type CashEvent = CashFlowEvent | CashBalanceAdjustmentEvent;

/** 一笔资产转移：币换了地方、转进转出，或白得的收益。不是买卖。 */
export type AssetTransfer = {
  id: string;
  occurredAt: ISODateString | ISODateTimeString;
  occurredTimeZone?: string;
  timePrecision: TimePrecision;
  assetSymbol: string;
  quantity: DecimalString;
  category: AssetTransferCategory;
  reason: AssetTransferReason;
  unitPrice?: DecimalString;
  networkFee?: DecimalString;
  fromLocation?: CustodyLocation;
  toLocation?: CustodyLocation;
  note?: string;
  createdAt: ISODateTimeString;
  updatedAt: ISODateTimeString;
};

/**
 * 一笔手续费算不进来的记号。
 * 原因是手续费币种和交易币种对不上。
 */
export type FeeAccountingIssue = {
  code: "UNSUPPORTED_FEE_CURRENCY";
  tradeId: string;
  assetSymbol: string;
  occurredAt: ISODateString | ISODateTimeString;
  fee: DecimalString;
  feeCurrency: CurrencyCode;
  tradeCurrency: CurrencyCode;
};

/** 算出来的一种币的持仓：手里剩多少、成本多少、盈亏多少。不存进账本。 */
export type Position = {
  assetSymbol: string;
  quantity: DecimalString;
  locationQuantities: Readonly<Record<CustodyLocation, DecimalString>>;
  averageCost: DecimalString;
  costBasis: DecimalString;
  latestPrice?: DecimalString;
  marketValue?: DecimalString;
  realizedPnl: DecimalString;
  giftIncome: DecimalString;
  unrealizedPnl?: DecimalString;
  currency: CurrencyCode;
  feeAccountingIssues?: readonly FeeAccountingIssue[];
};

/**
 * 一整本账本。账本结构版本是 5。
 * 里面有资产、交易、现金、转移、价格、手续费规则。
 */
export type LedgerData = {
  schemaVersion: 5;
  assets: Asset[];
  trades: Trade[];
  cashEvents: CashEvent[];
  assetTransfers: AssetTransfer[];
  priceSnapshots: PriceSnapshot[];
  feeRules: FeeRule[];
};
