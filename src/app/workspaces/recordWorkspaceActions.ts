/**
 * 这个文件管记账页存好一笔后，怎么把表单清回空白。
 * 清的时候留下币种和平台。
 * 表单本身在 `features/trades` 和 `features/prices`，页面在 `RecordWorkspace.tsx`。
 * 没有特别的决定。
 */
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

/**
 * 这个函数把交易表单清回空白，但留下币种和平台。
 * 清完告诉页面：两张表单里还有没有用户填过的东西。
 * 举例：记完一笔 BTC 买入 → 表单回到空白的 BTC、平台不变。
 * 不会出错。
 */
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

/**
 * 这个函数把价格表单清回空白，但留下币种和记价时刻。
 * 清完同样告诉页面还有没有填过的东西。
 * 不会出错。
 */
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
