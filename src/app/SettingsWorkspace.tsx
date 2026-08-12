"use client";

import {
  useEffect,
  useRef,
  useState,
  type ReactNode,
} from "react";

import { SurfaceCard } from "@/ui";
import type { HydrationStatus } from "./hydrationState";
import type { PersistenceOperation } from "./usePersistentLedger";

export const PUBLIC_CLEAR_LEDGER_CONFIRMATION_TEXT = "清空账本";

type SettingsTab = "market" | "fees" | "danger";
type ClearMode = "normal" | "recovery";

export function SettingsWorkspace({
  active,
  ledgerEpoch,
  marketPanel,
  feePanel,
  hydrationStatus,
  persistenceOperation,
  repositorySwitchBlocked,
  isReadOnly,
  canClearReadyLedger,
  canClearHydrationError,
  storageKind,
  onClear,
}: Readonly<{
  active: boolean;
  ledgerEpoch: number;
  marketPanel: ReactNode;
  feePanel: ReactNode;
  hydrationStatus: HydrationStatus;
  persistenceOperation: PersistenceOperation;
  repositorySwitchBlocked: boolean;
  isReadOnly: boolean;
  canClearReadyLedger: boolean;
  canClearHydrationError: boolean;
  storageKind: "indexeddb" | "ledger-file";
  onClear: (mode: ClearMode) => Promise<boolean>;
}>) {
  const [tab, setTab] = useState<SettingsTab>("market");
  const [dangerExpanded, setDangerExpanded] = useState(false);
  const [confirmationValue, setConfirmationValue] = useState("");
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");
  const dangerTriggerRef = useRef<HTMLButtonElement>(null);

  const clearMode: ClearMode | null =
    hydrationStatus === "ready" && canClearReadyLedger
      ? "normal"
      : hydrationStatus === "error" && canClearHydrationError
        ? "recovery"
        : null;
  const clearDisabled =
    persistenceOperation !== "idle" ||
    repositorySwitchBlocked ||
    isReadOnly;

  function closeDanger({ restoreFocus = false } = {}) {
    if (persistenceOperation !== "idle") return;
    setDangerExpanded(false);
    setConfirmationValue("");
    setError("");
    if (restoreFocus) {
      requestAnimationFrame(() => dangerTriggerRef.current?.focus());
    }
  }

  useEffect(() => {
    setTab("market");
    setDangerExpanded(false);
    setConfirmationValue("");
    setError("");
  }, [ledgerEpoch]);

  useEffect(() => {
    if (!dangerExpanded) return;
    const closeFromEscape = (event: globalThis.KeyboardEvent) => {
      if (event.key === "Escape") closeDanger({ restoreFocus: true });
    };
    document.addEventListener("keydown", closeFromEscape);
    return () => document.removeEventListener("keydown", closeFromEscape);
  });

  async function confirmClear() {
    if (!clearMode || clearDisabled) return;
    if (confirmationValue !== PUBLIC_CLEAR_LEDGER_CONFIRMATION_TEXT) {
      setError(
        `请输入完整确认文本“${PUBLIC_CLEAR_LEDGER_CONFIRMATION_TEXT}”`,
      );
      return;
    }
    setError("");
    setSuccess("");
    const cleared = await onClear(clearMode);
    if (!cleared) {
      setError("清空未完成；当前文件与页面状态以顶部错误提示为准");
      return;
    }
    setDangerExpanded(false);
    setConfirmationValue("");
    setSuccess(
      storageKind === "ledger-file"
        ? "当前账本内容已清空，.lftl 文件仍然存在"
        : "当前浏览器账本已清空",
    );
  }

  return (
    <section
      aria-label="设置工作区"
      className={active ? "grid min-w-0 gap-4" : "hidden"}
      data-workspace-page="settings"
    >
      <SurfaceCard className="p-5">
        <h2 className="text-lg font-semibold">账本设置</h2>
        <p className="mt-1 text-sm leading-6 text-[var(--ledger-muted)]">
          配置只作用于当前账本；历史经济规则通过新版本替换，不原地改写。
        </p>
      </SurfaceCard>

      <div
        aria-label="设置分类"
        className="flex flex-wrap gap-2 rounded-xl border border-[var(--ledger-border)] bg-[var(--ledger-surface-muted)] p-2"
        role="tablist"
      >
        {(
          [
            ["market", "行情与交易对"],
            ["fees", "手续费规则"],
            ["danger", "危险操作"],
          ] as const
        ).map(([value, label]) => (
          <button
            aria-selected={tab === value}
            className={
              tab === value
                ? "rounded-lg bg-white px-4 py-2 text-sm font-semibold text-[var(--ledger-ink)] shadow-sm"
                : "rounded-lg px-4 py-2 text-sm font-medium text-[var(--ledger-muted)]"
            }
            key={value}
            onClick={() => {
              setTab(value);
              if (value !== "danger") closeDanger();
            }}
            role="tab"
            type="button"
          >
            {label}
          </button>
        ))}
      </div>

      {tab === "market" ? (
        <SurfaceCard className="min-w-0 p-5">{marketPanel}</SurfaceCard>
      ) : null}
      {tab === "fees" ? (
        <SurfaceCard className="min-w-0 p-5">{feePanel}</SurfaceCard>
      ) : null}
      {tab === "danger" ? (
        <SurfaceCard className="min-w-0 border-red-100 p-5">
          {!dangerExpanded ? (
            <button
              className="rounded-md border border-red-200 bg-red-50 px-4 py-2 font-semibold text-red-800 disabled:opacity-50"
              disabled={!clearMode || clearDisabled}
              onClick={() => {
                setDangerExpanded(true);
                setError("");
                setSuccess("");
              }}
              ref={dangerTriggerRef}
              type="button"
            >
              打开清空账本操作
            </button>
          ) : (
            <div className="grid gap-4" role="region" aria-label="清空账本确认">
              <div className="rounded-md border border-red-200 bg-red-50 px-4 py-3 text-sm leading-6 text-red-900">
                <p className="font-semibold">这会清空当前账本内容</p>
                <p>
                  自定义资产、交易、价格和手续费规则都会清空；不会删除
                  {storageKind === "ledger-file"
                    ? "当前 .lftl 文件"
                    : "浏览器或应用本身"}
                  ，也不会增加“删除账本文件”能力。
                </p>
                <p>建议先到“导入与导出”导出一份明文备份并安全保管。</p>
              </div>
              <label className="grid gap-2 text-sm font-medium text-red-900">
                输入“{PUBLIC_CLEAR_LEDGER_CONFIRMATION_TEXT}”以确认
                <input
                  aria-label="输入清空确认文本"
                  className="rounded-md border border-red-300 bg-white px-3 py-2 font-normal text-slate-950"
                  disabled={persistenceOperation !== "idle"}
                  onChange={(event) => {
                    setConfirmationValue(event.target.value);
                    setError("");
                  }}
                  value={confirmationValue}
                />
              </label>
              {error ? <p aria-live="polite" className="text-sm text-red-800">{error}</p> : null}
              {persistenceOperation === "clearing" ? (
                <p aria-live="polite" className="text-sm font-medium text-red-900">
                  正在清空并复读验证，请勿关闭页面。
                </p>
              ) : null}
              <div className="flex flex-wrap gap-3">
                <button
                  className="rounded-md bg-red-800 px-4 py-2 font-semibold text-white disabled:opacity-50"
                  disabled={clearDisabled}
                  onClick={() => void confirmClear()}
                  type="button"
                >
                  确认清空账本内容
                </button>
                <button
                  className="rounded-md border border-slate-300 bg-white px-4 py-2 font-medium text-slate-700 disabled:opacity-50"
                  disabled={persistenceOperation !== "idle"}
                  onClick={() => closeDanger({ restoreFocus: true })}
                  type="button"
                >
                  取消
                </button>
              </div>
            </div>
          )}
        </SurfaceCard>
      ) : null}

      {success ? (
        <p aria-live="polite" className="rounded-md border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-800">
          {success}
        </p>
      ) : null}
    </section>
  );
}
