/**
 * 这个文件管新增手续费规则的那张表单。
 * 表单里的值和提交后做什么，都在上层 `FeeRuleManager.tsx` 管。
 * 没有特别的决定。
 */
"use client";

import type { FormState } from "./feeRuleManagerHelpers";
import type { LedgerData } from "@/core/models";
import type {
  Dispatch,
  FormEvent,
  SetStateAction,
} from "react";
import type { Translate } from "@/ui";

/**
 * 这个组件画新增手续费规则的表单。
 * 有名字、平台、币、类型、金额或比例。
 * 类型选「固定」填 USDT 金额，选「比例」填小数比例。
 * 点「新增」交给上层的提交处理。
 */
export function FeeRuleManagerForm({
  form,
  isWritable,
  ledgerData,
  setForm,
  submitNewRule,
  t,
}: Readonly<{
  form: FormState;
  isWritable: boolean;
  ledgerData: LedgerData;
  setForm: Dispatch<SetStateAction<FormState>>;
  submitNewRule: (event: FormEvent<HTMLFormElement>) => void;
  t: Translate;
}>) {
  return (
      <form
        className="order-2 grid content-start gap-3 rounded-lg border border-slate-200 p-4 md:grid-cols-2"
        onSubmit={submitNewRule}
      >
        <div className="md:col-span-2">
          <h3 className="font-semibold">{t("fees.newVersion.heading")}</h3>
          <p className="mt-1 text-xs text-slate-500">
            {t("fees.newVersion.description")}
          </p>
        </div>
        <label className="grid gap-1 text-sm font-medium">
          {t("fees.field.name")}
          <input
            className="rounded-md border border-slate-200 px-3 py-2 font-normal"
            disabled={!isWritable}
            onChange={(event) => setForm({ ...form, name: event.target.value })}
            value={form.name}
          />
        </label>
        <label className="grid gap-1 text-sm font-medium">
          {t("fees.field.platform")}
          <input
            className="rounded-md border border-slate-200 px-3 py-2 font-normal"
            disabled={!isWritable}
            onChange={(event) => setForm({ ...form, platform: event.target.value })}
            value={form.platform}
          />
        </label>
        <label className="grid gap-1 text-sm font-medium">
          {t("fees.field.asset")}
          <select
            className="rounded-md border border-slate-200 px-3 py-2 font-normal"
            disabled={!isWritable}
            onChange={(event) => setForm({ ...form, assetSymbol: event.target.value })}
            value={form.assetSymbol}
          >
            {ledgerData.assets.map((asset) => (
              <option key={asset.id} value={asset.symbol}>{asset.symbol}</option>
            ))}
          </select>
        </label>
        <label className="grid gap-1 text-sm font-medium">
          {t("fees.field.type")}
          <select
            className="rounded-md border border-slate-200 px-3 py-2 font-normal"
            disabled={!isWritable}
            onChange={(event) => setForm({ ...form, type: event.target.value as FormState["type"] })}
            value={form.type}
          >
            <option value="fixed">{t("fees.type.fixed")}</option>
            <option value="percentage">{t("fees.type.percentage")}</option>
          </select>
        </label>
        <label className="grid gap-1 text-sm font-medium">
          {form.type === "fixed" ? t("fees.field.fixedAmount") : t("fees.field.decimalRate")}
          <input
            className="rounded-md border border-slate-200 px-3 py-2 font-normal"
            disabled={!isWritable}
            inputMode="decimal"
            onChange={(event) => setForm({ ...form, value: event.target.value })}
            value={form.value}
          />
        </label>
        <button
          className="w-fit rounded-md bg-slate-950 px-4 py-2 text-sm font-medium text-white disabled:opacity-50"
          disabled={!isWritable}
          type="submit"
        >
          {t("fees.action.add")}
        </button>
      </form>
  );
}
