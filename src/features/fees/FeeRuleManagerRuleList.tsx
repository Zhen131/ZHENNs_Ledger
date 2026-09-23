"use client";

import { LedgerNumber } from "@/ui";
import type {
  FeeRule,
  LedgerData,
} from "@/core/models";
import type {
  Dispatch,
  SetStateAction,
} from "react";
import type { useLanguage } from "@/ui";

export function FeeRuleManagerRuleList({
  deactivateRule,
  isWritable,
  ledgerData,
  presentation,
  replaceRule,
  revisionValues,
  setRevisionValues,
  t,
}: Readonly<{
  deactivateRule: (rule: FeeRule) => void;
  isWritable: boolean;
  ledgerData: LedgerData;
  presentation: "legacy" | "settings";
  replaceRule: (rule: FeeRule) => void;
  revisionValues: Record<string, string>;
  setRevisionValues: Dispatch<SetStateAction<Record<string, string>>>;
  t: ReturnType<typeof useLanguage>["t"];
}>) {
  return (
      <div
        className={
          presentation === "settings"
            ? "order-1 grid content-start gap-3"
            : "grid gap-3"
        }
      >
        {presentation === "settings" ? (
          <h3 className="font-semibold">{t("fees.history.heading")}</h3>
        ) : null}
        {ledgerData.feeRules.length === 0 ? (
          <p className="text-sm text-slate-500">{t("fees.history.empty")}</p>
        ) : ledgerData.feeRules.map((rule) => (
          <article className="min-w-0 break-words rounded-md border border-slate-200 p-3 text-sm" key={rule.id}>
            <p className="font-medium">
              {rule.name} · {rule.platform} + {rule.assetSymbol} · {rule.status}
            </p>
            <p className="mt-1 text-slate-600">
              {rule.type === "fixed" ? (
                <>
                  {t("fees.history.fixedAmountLabel")} <LedgerNumber kind="money" value={rule.amount} /> USDT
                </>
              ) : (
                <>
                  {t("fees.history.tradeValue")} × <LedgerNumber kind="percent" value={rule.rate} />
                </>
              )} · ID {rule.id}
            </p>
            <p className="mt-1 text-xs text-slate-500">
              {t("fees.history.created")} {rule.createdAt}
              {rule.replacesFeeRuleId ? ` · ${t("fees.history.replaces")} ${rule.replacesFeeRuleId}` : ""}
              {rule.deactivatedAt ? ` · ${t("fees.history.deactivated")} ${rule.deactivatedAt}` : ""}
            </p>
            {rule.status === "active" ? (
              <div className="mt-3 flex flex-wrap items-end gap-2">
                <label className="grid gap-1 text-xs font-medium">
                  {t("fees.history.newVersion")}{rule.type === "fixed" ? t("fees.field.amount") : t("fees.field.rate")}
                  <input
                    aria-label={`${rule.name} ${t("fees.history.newVersion")}${rule.type === "fixed" ? t("fees.field.amount") : t("fees.field.rate")}`}
                    className="rounded-md border border-slate-200 px-2 py-1 text-sm font-normal"
                    disabled={!isWritable}
                    inputMode="decimal"
                    onChange={(event) => setRevisionValues({ ...revisionValues, [rule.id]: event.target.value })}
                    value={revisionValues[rule.id] ?? ""}
                  />
                </label>
                <button
                  className="rounded-md border border-slate-300 px-3 py-1.5 font-medium disabled:opacity-50"
                  disabled={!isWritable}
                  onClick={() => replaceRule(rule)}
                  type="button"
                >
                  {t("fees.action.replace")}
                </button>
                <button
                  className="rounded-md border border-red-300 px-3 py-1.5 font-medium text-red-700 disabled:opacity-50"
                  disabled={!isWritable}
                  onClick={() => deactivateRule(rule)}
                  type="button"
                >
                  {t("fees.action.deactivate")}
                </button>
              </div>
            ) : null}
          </article>
        ))}
      </div>
  );
}
