import type { ActionDispatch } from "react";

type ClockRefreshEffectDeps = {
  midnightDelay: number;
  requestClockRefresh: ActionDispatch<[]>;
};

export function runClockRefreshEffect(
  deps: ClockRefreshEffectDeps,
) {
  const {
    midnightDelay,
    requestClockRefresh,
  } = deps;
    const refreshClock = () => requestClockRefresh();
    const refreshWhenVisible = () => {
      if (document.visibilityState === "visible") {
        refreshClock();
      }
    };
    const midnightTimer = window.setTimeout(
      refreshClock,
      midnightDelay,
    );

    window.addEventListener("focus", refreshClock);
    document.addEventListener("visibilitychange", refreshWhenVisible);
    return () => {
      window.clearTimeout(midnightTimer);
      window.removeEventListener("focus", refreshClock);
      document.removeEventListener("visibilitychange", refreshWhenVisible);
    };
}
