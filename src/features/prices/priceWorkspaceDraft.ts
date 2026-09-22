import { getLedgerTimeZone, type LedgerClock } from "@/core/shared";

export type PriceWorkspaceDraft = {
  assetSymbol: string;
  price: string;
  recordedAt: string;
  recordedTime: string;
  recordedTimeZone: string;
  note: string;
};

/**
 * 新价格表单的唯一初始设定，规则与 `createTradeWorkspaceDraft` 相同：
 * 记账页草稿与 PriceForm 的 local state 共用这一处，初始地点是设备时区。
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
