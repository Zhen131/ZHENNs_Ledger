/**
 * 这个文件管交易旁边那个「删除」按钮和它的倒计时。
 * 真正删账、撤回在 app 的交易页里，这里只画按钮、报点击。
 * 不显然的决定：删除要点两次，再等倒计时才真删；倒计时长度见 `tradeDeleteDelay.ts`。
 */
"use client";

import {
  useEffect,
  useRef,
  type KeyboardEvent,
  type MouseEvent,
} from "react";
import { useLanguage } from "@/ui";
import { DELETE_DELAY_MS } from "./tradeDeleteDelay";

/** 删除按钮的四个阶段：没点、等确认、倒计时、正在存盘。 */
export type TradeDeletePhase =
  | "idle"
  | "armed"
  | "countdown"
  | "persisting";

/**
 * 这个组件画交易旁的删除按钮。
 * 点它叫 `onActivate`，进哪个阶段由上层定。
 * 交易页里：第一次点进入等确认，再点开始倒计时。
 * 等确认时点按钮外面或按 Esc，叫 `onCancel` 取消。
 * 倒计时中显示剩几秒和「撤回」，点撤回叫 `onUndo`。
 * 倒计时结束后显示「正在保存」。
 * 键盘按住不放时，只算一次点击。
 */
export function TradeDeleteControl({
  ariaLabel,
  className = "",
  disabled = false,
  phase,
  remainingMs = 0,
  delayMs = DELETE_DELAY_MS,
  onActivate,
  onCancel,
  onUndo,
}: Readonly<{
  ariaLabel: string;
  className?: string;
  disabled?: boolean;
  phase: TradeDeletePhase;
  remainingMs?: number;
  delayMs?: number;
  onActivate: () => void;
  onCancel: () => void;
  onUndo: () => void;
}>) {
  const { t } = useLanguage();
  const rootRef = useRef<HTMLDivElement>(null);
  const ignoreRepeatedKeyboardClickRef = useRef(false);

  useEffect(() => {
    if (phase !== "armed") return;

    const cancelFromOutside = (event: PointerEvent) => {
      if (!rootRef.current?.contains(event.target as Node)) {
        onCancel();
      }
    };
    const cancelFromEscape = (event: globalThis.KeyboardEvent) => {
      if (event.key === "Escape") onCancel();
    };

    document.addEventListener("pointerdown", cancelFromOutside);
    document.addEventListener("keydown", cancelFromEscape);
    return () => {
      document.removeEventListener("pointerdown", cancelFromOutside);
      document.removeEventListener("keydown", cancelFromEscape);
    };
  }, [onCancel, phase]);

  function handleKeyDown(event: KeyboardEvent<HTMLButtonElement>) {
    if (event.key !== "Enter" && event.key !== " ") return;
    if (event.repeat) {
      event.preventDefault();
      ignoreRepeatedKeyboardClickRef.current = true;
      return;
    }
    ignoreRepeatedKeyboardClickRef.current = false;
  }

  function handleActivate(event: MouseEvent<HTMLButtonElement>) {
    if (ignoreRepeatedKeyboardClickRef.current) {
      event.preventDefault();
      ignoreRepeatedKeyboardClickRef.current = false;
      return;
    }
    onActivate();
  }

  const progress = Math.max(
    0,
    Math.min(100, ((delayMs - remainingMs) / delayMs) * 100),
  );

  return (
    <div className={`min-w-0 ${className}`} ref={rootRef}>
      {phase === "countdown" ? (
        <div className="relative overflow-hidden rounded-md border border-amber-300 bg-amber-50">
          <div
            aria-hidden="true"
            className="absolute inset-y-0 left-0 bg-amber-200 transition-[width] duration-100 motion-reduce:transition-none"
            style={{ width: `${progress}%` }}
          />
          <button
            aria-label={`${t("trades.delete.undoPrefix")}${ariaLabel}`}
            className="relative w-full px-3 py-2 text-sm font-semibold text-amber-950"
            onClick={onUndo}
            type="button"
          >
            {t("trades.delete.countdownPrefix")}{(remainingMs / 1_000).toFixed(1)}{t("trades.delete.secondsSuffix")}
          </button>
        </div>
      ) : phase === "persisting" ? (
        <button
          aria-busy="true"
          aria-label={`${ariaLabel}${t("trades.delete.savingSuffix")}`}
          className="w-full rounded-md border border-slate-200 bg-slate-100 px-3 py-2 text-sm font-medium text-slate-500"
          disabled
          type="button"
        >
          {t("trades.delete.saving")}
        </button>
      ) : (
        <button
          aria-label={ariaLabel}
          aria-pressed={phase === "armed"}
          className={`w-full origin-right rounded-md border px-3 py-2 text-sm font-semibold transition-[transform,background-color,color,border-color] duration-[200ms] motion-reduce:transform-none motion-reduce:transition-none disabled:cursor-not-allowed disabled:opacity-50 ${
            phase === "armed"
              ? "scale-x-[1.03] border-red-800 bg-red-800 text-white"
              : "border-red-200 bg-white text-red-800 hover:border-red-400"
          }`}
          disabled={disabled}
          onClick={handleActivate}
          onKeyDown={handleKeyDown}
          type="button"
        >
          {phase === "armed" ? t("trades.delete.armed") : t("trades.delete.idle")}
        </button>
      )}
    </div>
  );
}
