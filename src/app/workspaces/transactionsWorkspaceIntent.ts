/**
 * 这个文件管别的页面跳到交易页时带的请求怎么落地。
 * 请求从哪里发出来，在 `useLedgerWorkspaceSession.ts` 和首页。
 * 没有特别的决定。
 */
import type {
  Dispatch,
  RefObject,
  SetStateAction,
} from "react";
import type { ActivityLocationRequest } from "./transactionsWorkspaceTypes";

type IntentEffectDeps = {
  active: boolean;
  clearLocationRequest: () => void;
  clearPendingDelete: () => void;
  intent: { page: "transactions"; filterDate: string; expandTradeId?: string; } | { page: "transactions"; locateDate: string; } | { page: "transactions"; expandTradeId: string; } | { page: "transactions"; clearFilters: true; } | null;
  locationRequestRef: RefObject<ActivityLocationRequest | null>;
  locationSequenceRef: RefObject<number>;
  onIntentConsumed: () => void;
  resetFilters: () => void;
  setArmedItemId: Dispatch<SetStateAction<string | null>>;
  setExactDate: Dispatch<SetStateAction<string>>;
  setExpandedItemId: Dispatch<SetStateAction<string | null>>;
  setFeedback: Dispatch<SetStateAction<string>>;
  setLocationRequest: Dispatch<SetStateAction<ActivityLocationRequest | null>>;
};

/**
 * 这个函数在交易页拿到一个请求时，先把页面清干净再照做。
 * 请求可以是：按某天筛选，展开某笔，滚到某天，清掉筛选。
 * 举例：首页点了 2026-11-05 那天 → 交易页只显示那天的流水。
 * 做完告诉外面这个请求已经用掉。不会出错。
 */
export function runIntentEffect(
  deps: IntentEffectDeps,
) {
  const {
    active,
    clearLocationRequest,
    clearPendingDelete,
    intent,
    locationRequestRef,
    locationSequenceRef,
    onIntentConsumed,
    resetFilters,
    setArmedItemId,
    setExactDate,
    setExpandedItemId,
    setFeedback,
    setLocationRequest,
  } = deps;
    if (!active || !intent) return;
    resetFilters();
    setExpandedItemId(null);
    setArmedItemId(null);
    clearPendingDelete();
    clearLocationRequest();
    setFeedback("");
    if ("filterDate" in intent && intent.filterDate) {
      setExactDate(intent.filterDate);
    }
    if ("expandTradeId" in intent && intent.expandTradeId) {
      setExpandedItemId(intent.expandTradeId);
    }
    if ("locateDate" in intent && intent.locateDate) {
      const request = {
        date: intent.locateDate,
        requestId: locationSequenceRef.current + 1,
      };
      locationSequenceRef.current = request.requestId;
      locationRequestRef.current = request;
      setLocationRequest(request);
    }
    onIntentConsumed();
}
