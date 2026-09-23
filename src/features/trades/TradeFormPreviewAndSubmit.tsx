"use client";

import { LedgerNumber } from "@/ui";
import type { TradeFormField } from "./tradeFormTypes";
import type { TradeWorkspaceDraft } from "./tradeWorkspaceDraft";
import type { RefObject } from "react";
import type { useLanguage } from "@/ui";
import type {
  DecimalString,
  FeeRule,
} from "@/core/models";

export function TradeFormPreviewAndSubmit({
  cashImpactPreview,
  currency,
  errors,
  feeCurrency,
  form,
  pendingMutationVersion,
  selectedCandidate,
  submitButtonRef,
  successState,
  t,
}: Readonly<{
  cashImpactPreview: { currentBalance: string; delta: string; nextBalance: string; deficit: string; } | undefined;
  currency: "USDT";
  errors: Partial<Record<TradeFormField, string>>;
  feeCurrency: string;
  form: TradeWorkspaceDraft;
  pendingMutationVersion: number | null;
  selectedCandidate: Readonly<{ rule: FeeRule; fee: DecimalString; currency: "USDT"; formula: string; }> | undefined;
  submitButtonRef: RefObject<HTMLButtonElement | null>;
  successState: "" | "certified" | "saving";
  t: ReturnType<typeof useLanguage>["t"];
}>) {
  return (
      <div className="md:col-span-2">
        {cashImpactPreview ? (
          <div className="mb-3 rounded-md border border-sky-200 bg-sky-50 px-3 py-2 text-sm text-sky-900">
            <p>
              {t("trades.form.preview.totalValue")}
              <LedgerNumber kind="money" value={form.totalValue} /> {currency}
            </p>
            <p>
              {t("trades.form.preview.actualFee")}
              <LedgerNumber
                kind={feeCurrency === "USDT" ? "money" : "quantity"}
                value={form.fee}
              />{" "}
              {feeCurrency}
            </p>
            <p>
              {t("trades.form.preview.currentCash")}
              <LedgerNumber kind="money" value={cashImpactPreview.currentBalance} /> USDT
            </p>
            <p>
              {t("trades.form.preview.cashDelta")}
              <LedgerNumber kind="money" value={cashImpactPreview.delta} /> USDT
            </p>
            <p>
              {t("trades.form.preview.nextCash")}
              <LedgerNumber kind="money" value={cashImpactPreview.nextBalance} /> USDT
            </p>
            <p>
              {t("trades.form.preview.source")}{selectedCandidate
                ? `${selectedCandidate.rule.name} · ${selectedCandidate.rule.id}`
                : t("trades.form.feeSource.manual")}
            </p>
          </div>
        ) : null}
        <button
          className="rounded-md bg-slate-950 px-4 py-2 text-sm font-medium text-white disabled:cursor-not-allowed disabled:opacity-50"
          disabled={pendingMutationVersion !== null}
          ref={submitButtonRef}
          type="submit"
        >
          {pendingMutationVersion === null ? t("trades.form.action.save") : t("trades.form.action.saving")}
        </button>
        <div aria-live="polite" className="mt-2 min-h-5 text-sm">
          {errors.form ? (
            <p className="text-red-700">{errors.form}</p>
          ) : successState ? (
            <p
              className={
                pendingMutationVersion
                  ? "text-sky-800"
                  : "text-emerald-700 motion-safe:animate-[ledger-feedback-fade_4s_ease-in_forwards]"
              }
            >
              {successState === "certified" ? t("trades.form.success.certified") : t("trades.form.action.saving")}
            </p>
          ) : null}
        </div>
      </div>
  );
}
