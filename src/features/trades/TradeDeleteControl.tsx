"use client";

import {
  useEffect,
  useRef,
  type KeyboardEvent,
  type MouseEvent,
} from "react";

export type TradeDeletePhase =
  | "idle"
  | "armed"
  | "countdown"
  | "persisting";

export function TradeDeleteControl({
  ariaLabel,
  className = "",
  disabled = false,
  phase,
  remainingMs = 0,
  delayMs = 5_000,
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
            aria-label={`撤回${ariaLabel}`}
            className="relative w-full px-3 py-2 text-sm font-semibold text-amber-950"
            onClick={onUndo}
            type="button"
          >
            撤回 · {(remainingMs / 1_000).toFixed(1)} 秒
          </button>
        </div>
      ) : phase === "persisting" ? (
        <button
          aria-busy="true"
          aria-label={`${ariaLabel}正在保存`}
          className="w-full rounded-md border border-slate-200 bg-slate-100 px-3 py-2 text-sm font-medium text-slate-500"
          disabled
          type="button"
        >
          正在保存…
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
          {phase === "armed" ? "再次点击删除" : "删除"}
        </button>
      )}
    </div>
  );
}
