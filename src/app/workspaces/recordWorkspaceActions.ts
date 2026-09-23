import type { LedgerClock } from "@/core/shared";
import type { TradeWorkspaceDraft } from "@/features/trades";
import type { PriceWorkspaceDraft } from "@/features/prices";
import type {
  Dispatch,
  SetStateAction,
} from "react";
import { createTradeWorkspaceDraft } from "@/features/trades";
import { workspaceDraftsHaveUserInput } from "./workspaceDrafts";
import { createPriceWorkspaceDraft } from "@/features/prices";

type ResetTradeDraftDeps = {
  clock: LedgerClock;
  onDraftStatusChange: (hasDrafts: boolean) => void;
  onTradeDraftChange: ((draft: TradeWorkspaceDraft) => void) | undefined;
  priceDraft: PriceWorkspaceDraft;
  todayKey: string;
  updateTradeDraft: Dispatch<SetStateAction<TradeWorkspaceDraft>>;
};

export function doResetTradeDraft(
  deps: ResetTradeDraftDeps,
  preserve: Pick<TradeWorkspaceDraft, "assetSymbol" | "platform">,
) {
  const {
    clock,
    onDraftStatusChange,
    onTradeDraftChange,
    priceDraft,
    todayKey,
    updateTradeDraft,
  } = deps;
    const nextDraft = {
      ...createTradeWorkspaceDraft(preserve.assetSymbol, todayKey, clock),
      platform: preserve.platform,
    };
    updateTradeDraft(nextDraft);
    onTradeDraftChange?.(nextDraft);
    onDraftStatusChange(
      workspaceDraftsHaveUserInput(nextDraft, priceDraft),
    );
}

type ResetPriceDraftDeps = {
  clock: LedgerClock;
  onDraftStatusChange: (hasDrafts: boolean) => void;
  onPriceDraftChange: ((draft: PriceWorkspaceDraft) => void) | undefined;
  tradeDraft: TradeWorkspaceDraft;
  updatePriceDraft: Dispatch<SetStateAction<PriceWorkspaceDraft>>;
};

export function doResetPriceDraft(
  deps: ResetPriceDraftDeps,
  preserve: Pick<PriceWorkspaceDraft, "assetSymbol" | "recordedAt">,
) {
  const {
    clock,
    onDraftStatusChange,
    onPriceDraftChange,
    tradeDraft,
    updatePriceDraft,
  } = deps;
    const nextDraft = createPriceWorkspaceDraft(
      preserve.assetSymbol,
      preserve.recordedAt,
      clock,
    );
    updatePriceDraft(nextDraft);
    onPriceDraftChange?.(nextDraft);
    onDraftStatusChange(
      workspaceDraftsHaveUserInput(tradeDraft, nextDraft),
    );
}
