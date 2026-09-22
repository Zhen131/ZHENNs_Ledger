import type { PriceWorkspaceDraft } from "@/features/prices";
import type { TradeWorkspaceDraft } from "@/features/trades";

export type RecordTarget =
  | { kind: "cash"; currency: "USDT" }
  | { kind: "asset-transfer" }
  | { kind: "trade"; assetSymbol: string };

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
