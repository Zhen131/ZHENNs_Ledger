"use client";

import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type ReactNode,
} from "react";

import { SurfaceCard, useLanguage } from "@/ui";
import type { HydrationStatus } from "./hydrationState";
import type { PersistenceOperation } from "./usePersistentLedger";

export const PUBLIC_CLEAR_LEDGER_CONFIRMATION_TEXT = "清空账本";
const SUCCESS_FEEDBACK_MS = 4_000;

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
  const { language, setLanguage, t } = useLanguage();
  const [tab, setTab] = useState<SettingsTab>("market");
  const [dangerExpanded, setDangerExpanded] = useState(false);
  const [confirmationValue, setConfirmationValue] = useState("");
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");
  const dangerTriggerRef = useRef<HTMLButtonElement>(null);
  const dangerConfirmationRef = useRef<HTMLDivElement>(null);
  const confirmationInputRef = useRef<HTMLInputElement>(null);
  const confirmClearRef = useRef<HTMLButtonElement>(null);
  const cancelClearRef = useRef<HTMLButtonElement>(null);
  const restoreFocusFrameRef = useRef<number | null>(null);

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

  const closeDanger = useCallback(
    ({ restoreFocus = false }: { restoreFocus?: boolean } = {}) => {
      if (persistenceOperation !== "idle") return;
      setDangerExpanded(false);
      setConfirmationValue("");
      setError("");
      if (restoreFocus) {
        if (restoreFocusFrameRef.current !== null) {
          cancelAnimationFrame(restoreFocusFrameRef.current);
        }
        restoreFocusFrameRef.current = requestAnimationFrame(() => {
          restoreFocusFrameRef.current = null;
          dangerTriggerRef.current?.focus();
        });
      }
    },
    [persistenceOperation],
  );

  useEffect(
    () => () => {
      if (restoreFocusFrameRef.current !== null) {
        cancelAnimationFrame(restoreFocusFrameRef.current);
      }
    },
    [],
  );

  useEffect(() => {
    setTab("market");
    setDangerExpanded(false);
    setConfirmationValue("");
    setError("");
  }, [ledgerEpoch]);

  useEffect(() => {
    if (!success) return;
    const timeout = setTimeout(() => setSuccess(""), SUCCESS_FEEDBACK_MS);
    return () => clearTimeout(timeout);
  }, [success]);

  useEffect(() => {
    if (!dangerExpanded) return;
    const input = confirmationInputRef.current;
    if (
      input &&
      !input.disabled &&
      dangerConfirmationRef.current?.contains(input)
    ) {
      input.focus();
    }
  }, [dangerExpanded]);

  useEffect(() => {
    if (!dangerExpanded) return;
    const closeFromEscape = (event: globalThis.KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        closeDanger({ restoreFocus: true });
      }
    };
    document.addEventListener("keydown", closeFromEscape);
    return () => document.removeEventListener("keydown", closeFromEscape);
  }, [closeDanger, dangerExpanded]);

  async function confirmClear() {
    if (!clearMode || clearDisabled) return;
    if (confirmationValue !== PUBLIC_CLEAR_LEDGER_CONFIRMATION_TEXT) {
      setError(
        `${t("settings.clear.error.confirmationPrefix")}“${PUBLIC_CLEAR_LEDGER_CONFIRMATION_TEXT}”`,
      );
      return;
    }
    setError("");
    setSuccess("");
    const cleared = await onClear(clearMode);
    if (!cleared) {
      setError(t("settings.clear.error.failed"));
      return;
    }
    setDangerExpanded(false);
    setConfirmationValue("");
    setSuccess(
      storageKind === "ledger-file"
        ? t("settings.clear.success.file")
        : t("settings.clear.success.browser"),
    );
  }

  const clearDisabledReason = !clearMode
    ? t("settings.clear.disabled.notAllowed")
    : isReadOnly
      ? t("settings.clear.disabled.readOnly")
      : repositorySwitchBlocked
        ? t("settings.clear.disabled.switching")
        : persistenceOperation !== "idle"
          ? t("settings.clear.disabled.operating")
          : "";

  return (
    <section
      aria-label={t("settings.workspace.ariaLabel")}
      className={active ? "grid min-w-0 gap-4" : "hidden"}
      data-workspace-page="settings"
    >
      <SurfaceCard className="p-5">
        <h2 className="text-lg font-semibold">{t("settings.heading")}</h2>
        <p className="mt-1 text-sm leading-6 text-[var(--ledger-muted)]">
          {t("settings.description")}
        </p>
      </SurfaceCard>

      <SurfaceCard className="p-5">
        <h2 className="text-lg font-semibold">
          {t("settings.language.heading")}
        </h2>
        <p className="mt-1 text-sm leading-6 text-[var(--ledger-muted)]">
          {t("settings.language.description")}
        </p>
        <label className="mt-4 grid max-w-sm gap-2 text-sm font-medium">
          {t("settings.language.label")}
          <select
            aria-label={t("settings.language.label")}
            className="rounded-lg border border-[var(--ledger-border)] bg-white px-3 py-2 text-[var(--ledger-ink)]"
            onChange={(event) =>
              setLanguage(event.target.value as typeof language)
            }
            value={language}
          >
            <option value="zh-CN">
              {t("settings.language.optionChinese")}
            </option>
            <option value="en">{t("settings.language.optionEnglish")}</option>
            <option value="hu">
              {t("settings.language.optionHungarian")}
            </option>
          </select>
        </label>
      </SurfaceCard>

      <div
        aria-label={t("settings.tabs.ariaLabel")}
        className="grid grid-cols-1 gap-2 rounded-xl border border-[var(--ledger-border)] bg-[var(--ledger-surface-muted)] p-2 sm:grid-cols-3"
        role="tablist"
      >
        {(
          [
            ["market", t("settings.tabs.market")],
            ["fees", t("settings.tabs.fees")],
            ["danger", t("settings.tabs.danger")],
          ] as const
        ).map(([value, label]) => (
          <button
            aria-controls={`settings-panel-${value}`}
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
        <SurfaceCard
          className="min-w-0 p-5"
          id="settings-panel-market"
          role="tabpanel"
        >
          {marketPanel}
        </SurfaceCard>
      ) : null}
      {tab === "fees" ? (
        <SurfaceCard
          className="min-w-0 p-5"
          id="settings-panel-fees"
          role="tabpanel"
        >
          {feePanel}
        </SurfaceCard>
      ) : null}
      {tab === "danger" ? (
        <SurfaceCard
          className="min-w-0 border-red-100 p-5"
          id="settings-panel-danger"
          role="tabpanel"
        >
          {!dangerExpanded ? (
            <div className="grid justify-items-start gap-2">
              <button
                aria-controls="clear-ledger-confirmation"
                aria-describedby={
                  clearDisabledReason
                    ? "clear-ledger-disabled-reason"
                    : undefined
                }
                aria-expanded="false"
                className="rounded-md border border-red-200 bg-red-50 px-4 py-2 font-semibold text-red-800 disabled:cursor-not-allowed disabled:opacity-50"
                disabled={!clearMode || clearDisabled}
                onClick={() => {
                  setDangerExpanded(true);
                  setError("");
                  setSuccess("");
                }}
                ref={dangerTriggerRef}
                type="button"
              >
                {t("settings.clear.open")}
              </button>
              {clearDisabledReason ? (
                <p
                  className="text-sm text-[var(--ledger-muted)]"
                  id="clear-ledger-disabled-reason"
                >
                  {t("settings.clear.unavailablePrefix")}：{clearDisabledReason}{t("settings.period")}
                </p>
              ) : null}
            </div>
          ) : (
            <div
              aria-label={t("settings.clear.confirmation.ariaLabel")}
              className="grid gap-4"
              id="clear-ledger-confirmation"
              onKeyDown={(event) => {
                if (event.key !== "Tab") return;
                const controls = [
                  confirmationInputRef.current,
                  confirmClearRef.current,
                  cancelClearRef.current,
                ].filter(
                  (
                    control,
                  ): control is HTMLInputElement | HTMLButtonElement =>
                    control !== null && !control.disabled,
                );
                if (controls.length === 0) return;
                const first = controls[0];
                const last = controls[controls.length - 1];
                if (
                  (event.shiftKey && document.activeElement === first) ||
                  (!event.shiftKey && document.activeElement === last)
                ) {
                  event.preventDefault();
                  (event.shiftKey ? last : first).focus();
                }
              }}
              ref={dangerConfirmationRef}
              role="region"
            >
              <div className="rounded-md border border-red-200 bg-red-50 px-4 py-3 text-sm leading-6 text-red-900">
                <p className="font-semibold">{t("settings.clear.confirmation.heading")}</p>
                <p>
                  {t("settings.clear.confirmation.descriptionPrefix")}
                  {storageKind === "ledger-file"
                    ? t("settings.clear.confirmation.file")
                    : t("settings.clear.confirmation.browser")}
                  {t("settings.clear.confirmation.descriptionSuffix")}
                </p>
                <p>{t("settings.clear.confirmation.backupAdvice")}</p>
              </div>
              <label className="grid gap-2 text-sm font-medium text-red-900">
                {t("settings.clear.confirmation.inputPrefix")}“{PUBLIC_CLEAR_LEDGER_CONFIRMATION_TEXT}”{t("settings.clear.confirmation.inputSuffix")}
                <input
                  aria-label={t("settings.clear.confirmation.inputAriaLabel")}
                  className="rounded-md border border-red-300 bg-white px-3 py-2 font-normal text-slate-950"
                  disabled={persistenceOperation !== "idle"}
                  onChange={(event) => {
                    setConfirmationValue(event.target.value);
                    setError("");
                  }}
                  ref={confirmationInputRef}
                  value={confirmationValue}
                />
              </label>
              {error ? <p aria-live="polite" className="text-sm text-red-800">{error}</p> : null}
              {persistenceOperation === "clearing" ? (
                <p aria-live="polite" className="text-sm font-medium text-red-900">
                  {t("settings.clear.confirmation.clearing")}
                </p>
              ) : null}
              <div className="flex flex-wrap gap-3">
                <button
                  className="rounded-md bg-red-800 px-4 py-2 font-semibold text-white disabled:opacity-50"
                  disabled={clearDisabled}
                  onClick={() => void confirmClear()}
                  ref={confirmClearRef}
                  type="button"
                >
                  {t("settings.clear.confirmation.confirm")}
                </button>
                <button
                  className="rounded-md border border-slate-300 bg-white px-4 py-2 font-medium text-slate-700 disabled:opacity-50"
                  disabled={persistenceOperation !== "idle"}
                  onClick={() => closeDanger({ restoreFocus: true })}
                  ref={cancelClearRef}
                  type="button"
                >
                  {t("settings.clear.confirmation.cancel")}
                </button>
              </div>
            </div>
          )}
        </SurfaceCard>
      ) : null}

      {success ? (
        <p
          aria-live="polite"
          className="rounded-md border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-800 motion-safe:animate-[ledger-feedback-fade_4s_ease-in_forwards]"
        >
          {success}
        </p>
      ) : null}
    </section>
  );
}
