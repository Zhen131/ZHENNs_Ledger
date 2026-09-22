import { getLedgerTimeZone, type LedgerClock } from "@/core/shared";

export type TradeWorkspaceDraft = {
  type: "buy" | "sell";
  assetSymbol: string;
  quantity: string;
  price: string;
  totalValue: string;
  totalValueMode: "auto" | "manual";
  occurredAt: string;
  occurredTime: string;
  occurredTimeZone: string;
  fee: string;
  feeCurrency: string;
  platform: string;
  note: string;
  noteExpanded: boolean;
};

/**
 * 新交易表单的唯一初始设定：记账页的草稿与 TradeForm 自己的 local state 都从这里出发。
 * 初始地点就是地点下拉框第一项的「设备时区」`getLedgerTimeZone(clock)`，
 * 不许出现界面显示设备时区、state 里却是空字符串的情况（W18 01A B0-1，D-1／D-2）。
 */
export function createTradeWorkspaceDraft(
  assetSymbol: string,
  todayKey: string,
  clock: LedgerClock,
): TradeWorkspaceDraft {
  return {
    type: "buy",
    assetSymbol,
    quantity: "",
    price: "",
    totalValue: "",
    totalValueMode: "auto",
    occurredAt: todayKey,
    occurredTime: "",
    occurredTimeZone: getLedgerTimeZone(clock),
    fee: "0",
    feeCurrency: "USDT",
    platform: "",
    note: "",
    noteExpanded: false,
  };
}
