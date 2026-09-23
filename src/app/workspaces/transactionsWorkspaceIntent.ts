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
