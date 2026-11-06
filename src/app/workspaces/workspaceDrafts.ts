/**
 * 这个文件管记账页上「表单里填没填东西」的判断。
 * 只看用户会动的栏，日期和买卖的币不算填过。
 * 表单本身在 `features/trades` 和 `features/prices`。
 * 没有特别的决定。
 */
import type { PriceWorkspaceDraft } from "@/features/prices";
import type { TradeWorkspaceDraft } from "@/features/trades";

/** 记账页当前在记什么：现金、资产转移，或某个币的买卖。 */
export type RecordTarget =
  | { kind: "cash"; currency: "USDT" }
  | { kind: "asset-transfer" }
  | { kind: "trade"; assetSymbol: string };

/**
 * 这个函数回答：交易表单或价格表单里，用户有没有填过东西？
 * 改过类型、数量、单价、手续费、平台、备注都算；只换了日期不算。
 * 举例：交易表单只填了数量 0.1 → 答有。
 * 不会出错。
 */
export function workspaceDraftsHaveUserInput(
  tradeDraft: TradeWorkspaceDraft,
  priceDraft: PriceWorkspaceDraft,
): boolean {
  return tradeDraftHasUserInput(tradeDraft) || priceDraftHasUserInput(priceDraft);
}

function tradeDraftHasUserInput(draft: TradeWorkspaceDraft): boolean {
  return (
    draft.type !== "buy" ||
    draft.quantity !== "" ||
    draft.price !== "" ||
    draft.totalValue !== "" ||
    draft.totalValueMode !== "auto" ||
    draft.fee !== "0" ||
    draft.feeCurrency !== "USDT" ||
    draft.platform !== "" ||
    draft.note !== "" ||
    draft.noteExpanded
  );
}

function priceDraftHasUserInput(draft: PriceWorkspaceDraft): boolean {
  return draft.price !== "" || draft.note !== "";
}
