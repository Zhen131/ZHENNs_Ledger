"use client";

import {
  useEffect,
  useRef,
  useState,
  type KeyboardEvent,
  type MouseEvent,
} from "react";

export type ConfirmDeleteOutcome = "applied" | "rejected" | "noop";

export type ConfirmDeleteButtonProps = Readonly<{
  label: string;
  confirmLabel?: string;
  ariaLabel: string;
  disabled?: boolean;
  onConfirm: () =>
    | ConfirmDeleteOutcome
    | Promise<ConfirmDeleteOutcome>;
}>;

/**
 * 普通删除的共享两段确认控件。
 *
 * 第一次激活只改变局部 armed 状态；第二次完整激活才调用业务回调。
 */
export function ConfirmDeleteButton({
  label,
  confirmLabel = "再次点击确认",
  ariaLabel,
  disabled = false,
  onConfirm,
}: ConfirmDeleteButtonProps) {
  const [armed, setArmed] = useState(false);
  const [busy, setBusy] = useState(false);
  const buttonRef = useRef<HTMLButtonElement | null>(null);
  const mountedRef = useRef(true);
  const ignoreRepeatedKeyboardClickRef = useRef(false);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);

  useEffect(() => {
    if (disabled) {
      setArmed(false);
      ignoreRepeatedKeyboardClickRef.current = false;
    }
  }, [disabled]);

  useEffect(() => {
    if (!armed) {
      return;
    }

    const cancelFromOutside = (event: PointerEvent) => {
      if (!buttonRef.current?.contains(event.target as Node)) {
        setArmed(false);
      }
    };
    const cancelFromEscape = (event: globalThis.KeyboardEvent) => {
      if (event.key === "Escape") {
        setArmed(false);
      }
    };

    document.addEventListener("pointerdown", cancelFromOutside);
    document.addEventListener("keydown", cancelFromEscape);
    return () => {
      document.removeEventListener("pointerdown", cancelFromOutside);
      document.removeEventListener("keydown", cancelFromEscape);
    };
  }, [armed]);

  function handleKeyDown(event: KeyboardEvent<HTMLButtonElement>) {
    if (event.key !== "Enter" && event.key !== " ") {
      return;
    }
    if (event.repeat) {
      event.preventDefault();
      ignoreRepeatedKeyboardClickRef.current = true;
      return;
    }
    ignoreRepeatedKeyboardClickRef.current = false;
  }

  async function handleClick(event: MouseEvent<HTMLButtonElement>) {
    if (ignoreRepeatedKeyboardClickRef.current) {
      event.preventDefault();
      ignoreRepeatedKeyboardClickRef.current = false;
      return;
    }
    if (disabled || busy) {
      return;
    }
    if (!armed) {
      setArmed(true);
      return;
    }

    setArmed(false);
    setBusy(true);
    try {
      await onConfirm();
    } finally {
      if (mountedRef.current) {
        setBusy(false);
      }
    }
  }

  return (
    <button
      aria-busy={busy}
      aria-label={ariaLabel}
      aria-pressed={armed}
      className={`origin-left rounded-md border px-3 py-2 text-sm font-medium transition-[transform,background-color,color,border-color] duration-[180ms] motion-reduce:transform-none motion-reduce:transition-none disabled:cursor-not-allowed disabled:opacity-50 ${
        armed
          ? "scale-x-[1.04] border-red-800 bg-red-800 text-white"
          : "border-red-300 bg-white text-red-800 hover:border-red-500 hover:text-red-950"
      }`}
      disabled={disabled || busy}
      onClick={(event) => void handleClick(event)}
      onKeyDown={handleKeyDown}
      ref={buttonRef}
      type="button"
    >
      {armed ? confirmLabel : label}
    </button>
  );
}
