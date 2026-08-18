"use client";

import { useEffect, useRef, type RefObject } from "react";

import type { CashMutationProjection } from "./cashProjection";

export function NegativeCashConfirmationDialog({
  title,
  projection,
  confirmLabel = "确认并保存",
  triggerRef,
  onCancel,
  onConfirm,
}: Readonly<{
  title: string;
  projection: CashMutationProjection;
  confirmLabel?: string;
  triggerRef?: RefObject<HTMLElement | null>;
  onCancel: () => void;
  onConfirm: () => void;
}>) {
  const cancelRef = useRef<HTMLButtonElement>(null);
  const confirmRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    const trigger = triggerRef?.current;
    confirmRef.current?.focus();
    return () => trigger?.focus();
  }, [triggerRef]);

  return (
    <div
      aria-label={title}
      aria-modal="true"
      className="fixed inset-0 z-50 grid place-items-center bg-slate-950/45 p-4"
      onKeyDown={(event) => {
        if (event.key === "Escape") {
          event.preventDefault();
          onCancel();
          return;
        }
        if (event.key !== "Tab") return;
        if (event.shiftKey && document.activeElement === cancelRef.current) {
          event.preventDefault();
          confirmRef.current?.focus();
        } else if (
          !event.shiftKey &&
          document.activeElement === confirmRef.current
        ) {
          event.preventDefault();
          cancelRef.current?.focus();
        }
      }}
      role="dialog"
    >
      <div className="w-full max-w-md rounded-2xl border border-red-200 bg-white p-5 shadow-2xl">
        <h2 className="text-lg font-semibold text-slate-950">{title}</h2>
        <p className="mt-2 text-sm leading-6 text-slate-700">
          这次操作会让 USDT 现金为负。负余额可以保存，但表示账本中的现金来源尚不完整。
        </p>
        <dl className="mt-4 grid grid-cols-[1fr_auto] gap-x-4 gap-y-2 rounded-xl bg-red-50 p-4 text-sm">
          <dt>当前余额</dt>
          <dd>{projection.currentBalance} USDT</dd>
          <dt>本次变化</dt>
          <dd>{projection.delta} USDT</dd>
          <dt className="font-semibold">保存后余额</dt>
          <dd className="font-semibold text-red-800">
            {projection.nextBalance} USDT
          </dd>
          <dt>现金缺口</dt>
          <dd>{projection.deficit} USDT</dd>
        </dl>
        <p className="mt-3 text-xs leading-5 text-slate-600">
          确认只对当前账本版本有效；若期间发生其他保存，本次确认会失效且不会写入。
        </p>
        <div className="mt-5 flex justify-end gap-3">
          <button
            className="rounded-md border border-slate-300 px-4 py-2 text-sm font-medium"
            onClick={onCancel}
            ref={cancelRef}
            type="button"
          >
            取消
          </button>
          <button
            className="rounded-md bg-red-700 px-4 py-2 text-sm font-medium text-white"
            onClick={onConfirm}
            ref={confirmRef}
            type="button"
          >
            {confirmLabel}
          </button>
        </div>
      </div>
    </div>
  );
}
