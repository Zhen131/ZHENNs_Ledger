/**
 * 这个文件放交易表「跳到某天」那件事后要做的事。
 * 什么时候触发由 `ActivityTable.tsx` 定，谁发起跳转在 app 的交易页。
 * 没有特别的决定。
 */
import type { LedgerActivityItem } from "./activityService";
import type {
  Dispatch,
  RefObject,
  SetStateAction,
} from "react";
import { getLedgerDateKey } from "@/core/shared";

type ActivityLocateEffectDeps = {
  items: readonly LedgerActivityItem[];
  locateRequest: Readonly<{ date: string; requestId: number; }> | null;
  onLocateComplete: (requestId: number, result: "found" | "missing") => void;
  rowRefs: RefObject<Map<string, HTMLTableRowElement>>;
  setLocatedDate: Dispatch<SetStateAction<string | null>>;
  setLocationMode: Dispatch<SetStateAction<"flashing" | "static" | null>>;
};

/**
 * 这个函数把交易表滚到某天的第一行，并让那一行闪一下。
 * 那天在当前页上没有行，就告诉发起的一方「没找到」。
 * 用户设了减少动画时，直接跳过去，高亮停一会儿再消失。
 * 跳完后告诉发起的一方「找到了」。
 * 返回的收尾函数会取消还没走完的计时。
 */
export function runActivityLocateEffect(
  deps: ActivityLocateEffectDeps,
) {
  const {
    items,
    locateRequest,
    onLocateComplete,
    rowRefs,
    setLocatedDate,
    setLocationMode,
  } = deps;
    setLocatedDate(null);
    setLocationMode(null);
    if (!locateRequest) return;
    const target = items.find(
      (item) => getLedgerDateKey(item.occurredAt) === locateRequest.date,
    );
    const targetRow = target ? rowRefs.current.get(target.id) : undefined;
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
    const finish = () => {
      if (cancelled) return;
      setLocatedDate(null);
      setLocationMode(null);
      onLocateComplete(locateRequest.requestId, "found");
    };
    const begin = () => {
      if (cancelled || highlightStarted) return;
      highlightStarted = true;
      if (fallbackTimer !== null) clearTimeout(fallbackTimer);
      scrollContainer.removeEventListener("scrollend", begin);
      setLocatedDate(locateRequest.date);
      setLocationMode("flashing");
      highlightTimer = setTimeout(finish, 800);
    };
    const reducedMotion =
      typeof window.matchMedia === "function" &&
      window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    if (reducedMotion) {
      targetRow.scrollIntoView?.({ behavior: "auto", block: "center" });
      setLocatedDate(locateRequest.date);
      setLocationMode("static");
      highlightTimer = setTimeout(finish, 1_200);
    } else {
      targetRow.scrollIntoView?.({ behavior: "smooth", block: "center" });
      if (supportsScrollEnd) {
        scrollContainer.addEventListener("scrollend", begin, { once: true });
      }
      fallbackTimer = setTimeout(begin, supportsScrollEnd ? 500 : 250);
    }
    return () => {
      cancelled = true;
      if (fallbackTimer !== null) clearTimeout(fallbackTimer);
      if (highlightTimer !== null) clearTimeout(highlightTimer);
      scrollContainer.removeEventListener("scrollend", begin);
    };
}
