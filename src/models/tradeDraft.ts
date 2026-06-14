import type { DecimalString, TimePrecision, TradeType } from "./ledger";

export type TradeDraft = {
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
  note?: string;
  rawText?: string;
};
