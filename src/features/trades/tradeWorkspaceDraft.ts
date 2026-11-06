/**
 * 这个文件管一件事：新交易表单一打开时各栏填什么。
 * 表单怎么画在 `TradeForm.tsx`，记账页怎么保管草稿在 app 的记账页里。
 * 不显然的决定：初始地点就是设备时区，不许留空；2026-09-22 定（W18 01A 第二节 D-1、D-2）。
 */
import { getLedgerTimeZone, type LedgerClock } from "@/core/shared";

/**
 * 交易表单里正在填的那些值，全是文字。
 * 有买卖方向、币、数量、单价、成交金额、时刻。
 * 还有手续费、平台、备注。
 * `totalValueMode` 记成交金额是自动算的还是人手填的。
 */
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
 * 这个函数回答：新交易表单一开始各栏填什么？
 * 记账页的草稿和 `TradeForm` 自己保管的表单都从这里出发。
 * 举例：币 BTC，今天 2026-09-22，设备在东京。
 * → 答买入 BTC，日期 2026-09-22，地点 Asia/Tokyo，手续费 0 USDT。
 * 为什么地点不留空：免得下拉框显示设备时区，值却是空的。
 * 这个问题 2026-09-22 定（W18 01A 第二节 D-1、D-2）。
 * 不会出错。
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
