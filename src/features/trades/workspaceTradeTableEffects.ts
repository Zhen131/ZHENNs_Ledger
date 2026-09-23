import type {
  Dispatch,
  RefObject,
  SetStateAction,
} from "react";
import { getLedgerDateKey } from "@/core/shared";
import type { Trade } from "@/core/models";

type TradeLocateEffectDeps = {
  locateRequest: Readonly<{ date: string; requestId: number; }> | null;
  onLocateComplete: (requestId: number, result: "found" | "missing") => void;
  rowRefs: RefObject<Map<string, HTMLTableRowElement>>;
  setLocatedDate: Dispatch<SetStateAction<string | null>>;
  setLocationMode: Dispatch<SetStateAction<"flashing" | "static" | null>>;
  trades: readonly Trade[];
};

export function runTradeLocateEffect(
  deps: TradeLocateEffectDeps,
) {
  const {
    locateRequest,
    onLocateComplete,
    rowRefs,
    setLocatedDate,
    setLocationMode,
    trades,
  } = deps;
    setLocatedDate(null);
    setLocationMode(null);
    if (!locateRequest) return;

    const targetTrade = trades.find(
      (trade) => getLedgerDateKey(trade.occurredAt) === locateRequest.date,
    );
    if (!targetTrade) {
      onLocateComplete(locateRequest.requestId, "missing");
      return;
    }
    const targetRow = rowRefs.current.get(targetTrade.id);
    if (!targetRow) {
      onLocateComplete(locateRequest.requestId, "missing");
      return;
    }

    let cancelled = false;
    let highlightStarted = false;
    let fallbackTimer: ReturnType<typeof setTimeout> | null = null;
    let highlightTimer: ReturnType<typeof setTimeout> | null = null;
    const scrollContainer =
      targetRow.closest<HTMLElement>("[data-ledger-scroll-container]") ??
      document;
    const supportsScrollEnd = "onscrollend" in scrollContainer;

    const finishLocation = () => {
      if (cancelled) return;
      setLocatedDate(null);
      setLocationMode(null);
      onLocateComplete(locateRequest.requestId, "found");
    };
    const beginFlashing = () => {
      if (cancelled || highlightStarted) return;
      highlightStarted = true;
      if (fallbackTimer !== null) clearTimeout(fallbackTimer);
      scrollContainer.removeEventListener("scrollend", beginFlashing);
      setLocatedDate(locateRequest.date);
      setLocationMode("flashing");
      highlightTimer = setTimeout(finishLocation, 800);
    };

    const prefersReducedMotion =
      typeof window.matchMedia === "function" &&
      window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    if (prefersReducedMotion) {
      targetRow.scrollIntoView?.({ behavior: "auto", block: "center" });
      setLocatedDate(locateRequest.date);
      setLocationMode("static");
      highlightTimer = setTimeout(finishLocation, 1_200);
    } else {
      targetRow.scrollIntoView?.({ behavior: "smooth", block: "center" });
      if (supportsScrollEnd) {
        scrollContainer.addEventListener("scrollend", beginFlashing, {
          once: true,
        });
      }
      fallbackTimer = setTimeout(beginFlashing, supportsScrollEnd ? 500 : 250);
    }

    return () => {
      cancelled = true;
      if (fallbackTimer !== null) clearTimeout(fallbackTimer);
      if (highlightTimer !== null) clearTimeout(highlightTimer);
      scrollContainer.removeEventListener("scrollend", beginFlashing);
    };
}
