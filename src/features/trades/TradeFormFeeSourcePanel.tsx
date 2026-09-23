"use client";

import {
  formatMoney,
  LedgerNumber,
} from "@/ui";
import type {
  FeeRuleCandidate,
  matchFeeRules,
} from "@/features/fees";
import type {
  DecimalString,
  FeeRule,
} from "@/core/models";
import type { TradeWorkspaceDraft } from "./tradeWorkspaceDraft";
import type {
  Dispatch,
  SetStateAction,
} from "react";
import type { useLanguage } from "@/ui";

export function TradeFormFeeSourcePanel({
  adoptCandidate,
  candidateWasModified,
  defaultCandidate,
  feeRuleMatch,
  form,
  selectedCandidate,
  selectedFeeRuleId,
  setSelectedFeeRuleId,
  sourceChangedMessage,
  t,
}: Readonly<{
  adoptCandidate: (candidate: FeeRuleCandidate) => void;
  candidateWasModified: boolean;
  defaultCandidate: Readonly<{ rule: FeeRule; fee: DecimalString; currency: "USDT"; formula: string; }> | undefined;
  feeRuleMatch: ReturnType<typeof matchFeeRules>;
  form: TradeWorkspaceDraft;
  selectedCandidate: Readonly<{ rule: FeeRule; fee: DecimalString; currency: "USDT"; formula: string; }> | undefined;
  selectedFeeRuleId: string;
  setSelectedFeeRuleId: Dispatch<SetStateAction<string>>;
  sourceChangedMessage: string;
  t: ReturnType<typeof useLanguage>["t"];
}>) {
  return (
      <div className="rounded-md border border-slate-200 bg-slate-50 p-3 text-sm md:col-span-2">
        <p className="font-medium">{t("trades.form.feeSource.heading")}</p>
        {feeRuleMatch.status === "missing-platform" ? (
          <p className="mt-1 text-slate-600">{t("trades.form.feeSource.missingPlatform")}</p>
        ) : feeRuleMatch.status === "invalid-total-value" ? (
          <p className="mt-1 text-slate-600">{t("trades.form.feeSource.invalidTotalValue")}</p>
        ) : feeRuleMatch.status === "no-match" ? (
          <p className="mt-1 text-slate-600">{t("trades.form.feeSource.noMatch")}</p>
        ) : feeRuleMatch.status === "conflict" ? (
          <div className="mt-2 grid gap-2">
            <p className="font-medium text-red-700">
              {t("trades.form.feeSource.conflict")}
            </p>
            <label className="grid gap-1 font-medium">
              {t("trades.form.feeSource.selectRule")}
              <select
                className="rounded-md border border-red-200 bg-white px-3 py-2 font-normal"
                onChange={(event) => setSelectedFeeRuleId(event.target.value)}
                value={selectedFeeRuleId}
              >
                <option value="">{t("trades.form.feeSource.keepManual")}</option>
                {feeRuleMatch.candidates.map((candidate) => (
                  <option key={candidate.rule.id} value={candidate.rule.id}>
                    {candidate.rule.name} · {candidate.rule.id} ·{" "}
                    {formatMoney(candidate.fee)} USDT
                  </option>
                ))}
              </select>
            </label>
          </div>
        ) : (
          <p className="mt-1 text-slate-600">{t("trades.form.feeSource.matched")}</p>
        )}

        {defaultCandidate ? (
          <div className="mt-2 rounded-md border border-sky-200 bg-white p-3">
            <p>
              {t("trades.form.feeSource.candidate")}
              <LedgerNumber kind="money" value={defaultCandidate.fee} />{" "}
              {defaultCandidate.currency} · {defaultCandidate.rule.name}
              （{defaultCandidate.rule.id}）
            </p>
            <p className="mt-1 text-xs text-slate-500">
              {defaultCandidate.rule.type} · {t("trades.form.feeSource.formula")} {" "}
              {defaultCandidate.rule.type === "fixed" ? (
                <>
                  <LedgerNumber kind="money" value={defaultCandidate.rule.amount} />{" "}
                  USDT fixed
                </>
              ) : (
                <>
                  <LedgerNumber kind="money" value={form.totalValue} /> ×{" "}
                  <LedgerNumber kind="percent" value={defaultCandidate.rule.rate} />
                </>
              )}
            </p>
            <button
              className="mt-2 rounded-md border border-sky-300 px-3 py-1.5 font-medium text-sky-900"
              onClick={() => adoptCandidate(defaultCandidate)}
              type="button"
            >
              {selectedCandidate ? t("trades.form.feeSource.readopt") : t("trades.form.feeSource.adopt")}
            </button>
          </div>
        ) : null}

        {candidateWasModified ? (
          <p className="mt-2 font-medium text-amber-800">
            {t("trades.form.feeSource.modified")}
          </p>
        ) : null}
        {sourceChangedMessage ? (
          <p className="mt-2 font-medium text-amber-800">{sourceChangedMessage}</p>
        ) : null}
      </div>
  );
}
