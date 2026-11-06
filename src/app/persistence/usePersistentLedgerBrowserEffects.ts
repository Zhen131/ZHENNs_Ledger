/**
 * 这个文件放账本存取 hook 用到的两个浏览器小动作。
 * 它们不碰账本内容，账本存取在同目录别的文件里。
 * 换日不只靠定时器，切回窗口也看一眼时间。
 * 没有特别的决定。
 */
import type { ActionDispatch } from "react";

type ClockRefreshEffectDeps = {
  midnightDelay: number;
  requestClockRefresh: ActionDispatch<[]>;
};

/**
 * 这个函数让页面在几种时候刷新一次日期。
 * 过了零点，切回窗口，窗口变可见，都算。
 * 举例：午夜前 10 分钟打开 → 10 分钟后自动换到第二天。
 * 返回一个收拾的函数，页面关掉时调它。不会出错。
 */
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

type LeaveWarningEffectDeps = {
  isDirty: boolean;
};

/**
 * 这个函数在还有没存好的改动时，让浏览器关页前先问一句。
 * 举例：记了一笔还没存完就点关闭 → 浏览器先问要不要离开。
 * 全都存好了就什么都不做。不会出错。
 */
export function runLeaveWarningEffect(
  deps: LeaveWarningEffectDeps,
) {
  const {
    isDirty,
  } = deps;
    if (!isDirty) {
      return;
    }

    function warnBeforeUnload(event: BeforeUnloadEvent) {
      event.preventDefault();
      event.returnValue = "";
    }

    window.addEventListener("beforeunload", warnBeforeUnload);
    return () => {
      window.removeEventListener("beforeunload", warnBeforeUnload);
    };
}
