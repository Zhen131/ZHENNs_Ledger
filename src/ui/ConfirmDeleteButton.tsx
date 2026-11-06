/**
 * 这个文件管普通删除用的「点两下才删」按钮。
 * 删什么、删完怎么撤回，由用它的列表自己管。
 * 不显然的决定：按住回车自动连发的那一下不算第二次点。
 */
"use client";

import {
  useEffect,
  useRef,
  useState,
  type KeyboardEvent,
  type MouseEvent,
} from "react";
import { useLanguage } from "./i18n";

/** 确认删除之后的结果：删掉了、被拒绝了、或者什么都没变。 */
export type ConfirmDeleteOutcome = "applied" | "rejected" | "noop";

type ConfirmDeleteButtonProps = Readonly<{
  label: string;
  confirmLabel?: string;
  ariaLabel: string;
  disabled?: boolean;
  onConfirm: () =>
    | ConfirmDeleteOutcome
    | Promise<ConfirmDeleteOutcome>;
}>;

/**
 * 这个组件画一个两段确认的删除按钮。
 * 它用在各个列表的普通删除上。
 * 第一次点，按钮变红变宽，文字换成确认的说法。
 * 第二次点，才叫 `onConfirm` 去真删。
 * 点按钮外面或按 Esc，就退回第一次点之前。
 * 删的过程中按钮变灰，不能再点。
 */
export function ConfirmDeleteButton({
  label,
  confirmLabel,
  ariaLabel,
  disabled = false,
  onConfirm,
}: ConfirmDeleteButtonProps) {
  const { t } = useLanguage();
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
      {armed ? (confirmLabel ?? t("shared.confirmDelete.confirm")) : label}
    </button>
  );
}
