/**
 * 这个文件管交易表单里「成交金额」那一栏。
 * 成交金额怎么自动算在 `tradeFormHelpers.ts` 的 `calculateAutomaticTotal`。
 * 不显然的决定：人改过成交金额后，它不再跟着数量单价变。
 * 为什么这样，这是猜的，要核。
 */
"use client";

import { calculateAutomaticTotal } from "./tradeFormHelpers";
import type {
  TradeFormField,
  TradeFormState,
} from "./tradeFormTypes";
import type { TradeWorkspaceDraft } from "./tradeWorkspaceDraft";
import type {
  Dispatch,
  SetStateAction,
} from "react";
import type { Translate } from "@/ui";

/**
 * 这个组件画成交金额那一栏，旁边标着「自动」或「手填」。
 * 自动时点进去会全选，方便直接改。
 * 点「重新计算」按数量乘单价算一次，并改回自动。
 * 举例：数量 0.1、单价 65000，点重新计算 → 成交金额变成 6500。
 */
export function TradeFormTotalValueField({
  commitForm,
  errors,
  form,
  setErrors,
  setSuccessState,
  t,
  updateField,
}: Readonly<{
  commitForm: (next: TradeFormState) => void;
  errors: Partial<Record<TradeFormField, string>>;
  form: TradeWorkspaceDraft;
  setErrors: Dispatch<SetStateAction<Partial<Record<TradeFormField, string>>>>;
  setSuccessState: Dispatch<SetStateAction<"" | "certified" | "saving">>;
  t: Translate;
  updateField: <Field extends keyof TradeFormState>(field: Field, value: TradeFormState[Field]) => void;
}>) {
  return (
      <label className="grid gap-2 text-sm font-medium">
        <span className="flex items-center justify-between gap-2">
          {t("trades.form.field.totalValue")}
          <span className="text-xs font-normal text-[var(--ledger-muted)]">
            {form.totalValueMode === "auto" ? t("trades.form.totalValue.auto") : t("trades.form.totalValue.manual")}
          </span>
        </span>
        <div className="flex gap-2">
          <input
            aria-label={t("trades.form.field.totalValue")}
            className="min-w-0 flex-1 rounded-md border border-slate-200 px-3 py-2 font-normal outline-none focus:border-slate-400"
            inputMode="decimal"
            onChange={(event) => updateField("totalValue", event.target.value)}
            onClick={(event) => {
              if (form.totalValueMode === "auto") event.currentTarget.select();
            }}
            onFocus={(event) => {
              if (form.totalValueMode === "auto") event.currentTarget.select();
            }}
            placeholder="11"
            value={form.totalValue}
          />
          <button
            className="shrink-0 rounded-md border border-slate-200 px-3 py-2 text-xs font-medium text-slate-700"
            onClick={() => {
              commitForm({
                ...form,
                totalValue: calculateAutomaticTotal(form.quantity, form.price),
                totalValueMode: "auto",
              });
              setErrors((current) => ({
                ...current,
                totalValue: undefined,
                form: undefined,
              }));
              setSuccessState("");
            }}
            type="button"
          >
            {t("trades.form.totalValue.recalculate")}
          </button>
        </div>
        {errors.totalValue ? (
          <span className="text-xs font-normal text-red-700">{errors.totalValue}</span>
        ) : null}
      </label>
  );
}
