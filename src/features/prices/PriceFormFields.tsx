"use client";

import {
  FACT_TIME_ZONE_OPTIONS,
  getLedgerTimeZone,
} from "@/core/shared";
import type { LedgerClock } from "@/core/shared";
import type {
  PriceFormField,
  PriceFormState,
} from "./priceFormHelpers";
import type { Ref } from "react";
import type { PriceWorkspaceDraft } from "./priceWorkspaceDraft";
import type { LedgerData } from "@/core/models";
import type { useLanguage } from "@/ui";

export function PriceFormFields({
  clock,
  currency,
  errors,
  focusTargetRef,
  form,
  ledgerData,
  pendingMutationVersion,
  savingMessage,
  successMessage,
  t,
  updateField,
}: Readonly<{
  clock: LedgerClock;
  currency: "USDT";
  errors: Partial<Record<PriceFormField, string>>;
  focusTargetRef: Ref<HTMLSelectElement> | undefined;
  form: PriceWorkspaceDraft;
  ledgerData: LedgerData;
  pendingMutationVersion: number | null;
  savingMessage: string;
  successMessage: string;
  t: ReturnType<typeof useLanguage>["t"];
  updateField: <Field extends keyof PriceFormState>(field: Field, value: PriceFormState[Field]) => void;
}>) {
  return (
      <div
        aria-disabled={pendingMutationVersion !== null}
        className={
          pendingMutationVersion === null
            ? "contents"
            : "contents pointer-events-none opacity-75"
        }
      >
      <label className="grid gap-2 text-sm font-medium">
        {t("prices.field.asset")}
        <select
          className="rounded-md border border-slate-200 px-3 py-2 font-normal outline-none focus:border-slate-400"
          onChange={(event) => updateField("assetSymbol", event.target.value)}
          ref={focusTargetRef}
          value={form.assetSymbol}
        >
          {ledgerData.assets.map((asset) => (
            <option key={asset.id} value={asset.symbol}>
              {asset.symbol} · {asset.name}
            </option>
          ))}
        </select>
        {errors.assetSymbol ? (
          <span className="text-xs font-normal text-red-700">
            {errors.assetSymbol}
          </span>
        ) : null}
      </label>

      <label className="grid gap-2 text-sm font-medium">
        {t("prices.field.currentPrice")}
        <span className="flex overflow-hidden rounded-md border border-slate-200 bg-white focus-within:border-slate-400">
          <input
            aria-label={t("prices.field.currentPrice")}
            className="min-w-0 flex-1 px-3 py-2 font-normal outline-none"
            inputMode="decimal"
            onChange={(event) => updateField("price", event.target.value)}
            placeholder="70000"
            value={form.price}
          />
          <span
            aria-label={`${t("prices.field.currencyAriaPrefix")} ${currency}`}
            className="border-l border-slate-200 bg-slate-50 px-3 py-2 font-normal text-slate-600"
          >
            {currency}
          </span>
        </span>
        {errors.price ? (
          <span className="text-xs font-normal text-red-700">{errors.price}</span>
        ) : null}
      </label>

      <label className="grid gap-2 text-sm font-medium">
        {t("prices.field.date")}
        <input
          className="rounded-md border border-slate-200 px-3 py-2 font-normal outline-none focus:border-slate-400"
          onChange={(event) => updateField("recordedAt", event.target.value)}
          type="date"
          value={form.recordedAt}
        />
        {errors.recordedAt ? (
          <span className="text-xs font-normal text-red-700">
            {errors.recordedAt}
          </span>
        ) : null}
      </label>

      <label className="grid gap-2 text-sm font-medium">
        {t("prices.field.time")}
        <input
          className="rounded-md border border-slate-200 px-3 py-2 font-normal outline-none focus:border-slate-400"
          onChange={(event) => updateField("recordedTime", event.target.value)}
          type="time"
          value={form.recordedTime}
        />
      </label>

      <label className="grid gap-2 text-sm font-medium">
        {t("prices.field.timeZone")}
        <select
          className="rounded-md border border-slate-200 px-3 py-2 font-normal outline-none focus:border-slate-400"
          onChange={(event) =>
            updateField("recordedTimeZone", event.target.value)
          }
          value={form.recordedTimeZone}
        >
          <option value={getLedgerTimeZone(clock)}>
            {t("prices.timeZone.device")}: {getLedgerTimeZone(clock)}
          </option>
          {FACT_TIME_ZONE_OPTIONS.filter(
            (timeZone) => timeZone !== getLedgerTimeZone(clock),
          ).map((timeZone) => (
            <option key={timeZone} value={timeZone}>
              {timeZone}
            </option>
          ))}
        </select>
      </label>

      <label className="grid gap-2 text-sm font-medium">
        {t("prices.field.note")}
        <input
          className="rounded-md border border-slate-200 px-3 py-2 font-normal outline-none focus:border-slate-400"
          onChange={(event) => updateField("note", event.target.value)}
          placeholder={t("prices.field.optional")}
          value={form.note}
        />
      </label>

      <button
        className="rounded-md bg-slate-950 px-4 py-2 text-sm font-medium text-white disabled:cursor-not-allowed disabled:opacity-50"
        disabled={pendingMutationVersion !== null}
        type="submit"
      >
        {pendingMutationVersion === null ? t("prices.action.save") : savingMessage}
      </button>
      <div aria-live="polite" className="min-h-5 text-sm">
        {errors.form ? (
          <p className="text-red-700">{errors.form}</p>
        ) : successMessage ? (
          <p className="text-emerald-700 motion-safe:animate-[ledger-feedback-fade_4s_ease-in_forwards]">
            {successMessage}
          </p>
        ) : null}
      </div>
      </div>
  );
}
