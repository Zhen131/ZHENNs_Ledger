/**
 * 这个文件管一件事：新价格表单一打开时各栏填什么。
 * 表单怎么画在 `PriceForm.tsx`，记账页怎么保管草稿在 app 的记账页里。
 * 不显然的决定：初始地点就是设备时区，不许留空；2026-09-22 定（W18 01A 第二节 D-1、D-2）。
 */
import { getLedgerTimeZone, type LedgerClock } from "@/core/shared";

/**
 * 价格表单里正在填的那些值，全是文字。
 * 有币、价格、日期、时间、地点、备注。
 */
export type PriceWorkspaceDraft = {
  assetSymbol: string;
  price: string;
  recordedAt: string;
  recordedTime: string;
  recordedTimeZone: string;
  note: string;
};

/**
 * 这个函数回答：新价格表单一开始各栏填什么？
 * 记账页的草稿和 `PriceForm` 自己保管的表单都从这里出发。
 * 规矩和交易表单的 `createTradeWorkspaceDraft` 一样。
 * 举例：币 ETH，今天 2026-09-22，设备在东京。
 * → 答币 ETH，日期 2026-09-22，地点 Asia/Tokyo，价格空着。
 * 为什么地点不留空：交易表单和价格表单当时同病同修。
 * 这个问题 2026-09-22 定（W18 01A 第二节 D-1、D-2、D-5）。
 * 不会出错。
 */
export function createPriceWorkspaceDraft(
  assetSymbol: string,
  todayKey: string,
  clock: LedgerClock,
): PriceWorkspaceDraft {
  return {
    assetSymbol,
    price: "",
    recordedAt: todayKey,
    recordedTime: "",
    recordedTimeZone: getLedgerTimeZone(clock),
    note: "",
  };
}
