"use client";

import { SurfaceCard } from "@/ui";
import type {
  Dispatch,
  RefObject,
  SetStateAction,
} from "react";
import type { PersistenceOperation } from "@/app/persistence";
import type { useLanguage } from "@/ui";

export function SettingsWorkspaceDangerPanel({
  cancelClearRef,
  clearConfirmationPhrase,
  clearDisabled,
  clearDisabledReason,
  clearMode,
  closeDanger,
  confirmClear,
  confirmClearRef,
  confirmationInputRef,
  confirmationValue,
  dangerConfirmationRef,
  dangerExpanded,
  dangerTriggerRef,
  error,
  persistenceOperation,
  setConfirmationValue,
  setDangerExpanded,
  setError,
  setSuccess,
  storageKind,
  t,
}: Readonly<{
  cancelClearRef: RefObject<HTMLButtonElement | null>;
  clearConfirmationPhrase: string;
  clearDisabled: boolean;
  clearDisabledReason: string;
  clearMode: "normal" | "recovery" | null;
  closeDanger: ({ restoreFocus }?: { restoreFocus?: boolean; }) => void;
  confirmClear: () => Promise<void>;
  confirmClearRef: RefObject<HTMLButtonElement | null>;
  confirmationInputRef: RefObject<HTMLInputElement | null>;
  confirmationValue: string;
  dangerConfirmationRef: RefObject<HTMLDivElement | null>;
  dangerExpanded: boolean;
  dangerTriggerRef: RefObject<HTMLButtonElement | null>;
  error: string;
  persistenceOperation: PersistenceOperation;
  setConfirmationValue: Dispatch<SetStateAction<string>>;
  setDangerExpanded: Dispatch<SetStateAction<boolean>>;
  setError: Dispatch<SetStateAction<string>>;
  setSuccess: Dispatch<SetStateAction<string>>;
  storageKind: "indexeddb" | "ledger-file";
  t: ReturnType<typeof useLanguage>["t"];
}>) {
  return (
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
                  {t("settings.clear.unavailablePrefix")}{t("settings.clear.unavailableSeparator")}{clearDisabledReason}{t("settings.period")}
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
                {t("settings.clear.confirmation.inputPrefix")}“{clearConfirmationPhrase}”{t("settings.clear.confirmation.inputSuffix")}
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
  );
}
