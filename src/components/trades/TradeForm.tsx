"use client";

import { useState, type FormEvent } from "react";

import type { LedgerData, Trade, TradeDraft } from "../../models";
import { createValidatedTrade } from "../../services/tradeService";
import type { TradeValidationError } from "../../validators/tradeValidator";

type TradeFormProps = Readonly<{
  ledgerData: LedgerData;
  onTradeCreated: (trade: Trade) => void;
}>;

type TradeFormState = {
  type: "buy" | "sell";
  assetSymbol: string;
  quantity: string;
  price: string;
  totalValue: string;
  occurredAt: string;
  fee: string;
  note: string;
};

type TradeFormField = keyof TradeFormState | "form";

const fieldLabels: Record<keyof TradeDraft, string> = {
  occurredAt: "日期",
  timePrecision: "时间精度",
  type: "类型",
  assetSymbol: "资产",
  quantity: "数量",
  price: "成交均价",
  totalValue: "总金额",
  currency: "计价货币",
  fee: "手续费",
  feeCurrency: "手续费币种",
  feeRuleId: "手续费规则",
  note: "备注",
  rawText: "原始文本",
};

function createInitialFormState(assetSymbol: string): TradeFormState {
  return {
    type: "buy",
    assetSymbol,
    quantity: "",
    price: "",
    totalValue: "",
    occurredAt: "",
    fee: "0",
    note: "",
  };
}

function formatValidationError(error: TradeValidationError): string {
  const label =
    error.field === "input" || error.field === "totalValueTolerance"
      ? "交易"
      : fieldLabels[error.field];

  switch (error.code) {
    case "INVALID_TRADE_TYPE":
      return "请选择买入或卖出";
    case "ASSET_NOT_FOUND":
      return "请选择账本中已有的资产";
    case "INVALID_DECIMAL":
      return `${label}必须是有效数字`;
    case "VALUE_MUST_BE_POSITIVE":
      return `${label}必须大于 0`;
    case "FEE_MUST_BE_NON_NEGATIVE":
      return "手续费不能小于 0";
    case "TOTAL_VALUE_MISMATCH":
      return "总金额与数量 × 成交均价不一致";
    case "INSUFFICIENT_HOLDINGS":
      return "卖出数量超过该时间点的可用持仓";
    case "CURRENCY_MISMATCH":
      return "计价货币与资产或已有交易不一致";
    case "INVALID_INPUT":
      return `${label}不能为空或格式不正确`;
  }
}

export function TradeForm({
  ledgerData,
  onTradeCreated,
}: TradeFormProps) {
  const defaultAssetSymbol = ledgerData.assets[0]?.symbol ?? "";
  const [form, setForm] = useState<TradeFormState>(() =>
    createInitialFormState(defaultAssetSymbol),
  );
  const [errors, setErrors] = useState<
    Partial<Record<TradeFormField, string>>
  >({});
  const [successMessage, setSuccessMessage] = useState("");

  const selectedAsset =
    ledgerData.assets.find((asset) => asset.symbol === form.assetSymbol) ??
    ledgerData.assets[0];
  const currency = selectedAsset?.quoteCurrency ?? "";

  function updateField<Field extends keyof TradeFormState>(
    field: Field,
    value: TradeFormState[Field],
  ) {
    setForm((current) => ({ ...current, [field]: value }));
    setErrors((current) => ({ ...current, [field]: undefined, form: undefined }));
    setSuccessMessage("");
  }

  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();

    const result = createValidatedTrade(
      {
        occurredAt: form.occurredAt,
        timePrecision: "day",
        type: form.type,
        assetSymbol: form.assetSymbol,
        quantity: form.quantity,
        price: form.price,
        totalValue: form.totalValue,
        currency,
        fee: form.fee,
        feeCurrency: currency,
        ...(form.note.trim() === "" ? {} : { note: form.note.trim() }),
      },
      ledgerData,
    );

    if (!result.ok) {
      if (result.kind === "service") {
        setErrors({ form: "系统暂时无法生成交易，请稍后重试" });
        return;
      }

      const nextErrors: Partial<Record<TradeFormField, string>> = {};
      for (const error of result.errors) {
        const field =
          error.field === "input" || error.field === "totalValueTolerance"
            ? "form"
            : error.field;
        nextErrors[field] ??= formatValidationError(error);
      }
      setErrors(nextErrors);
      setSuccessMessage("");
      return;
    }

    onTradeCreated(result.trade);
    setForm((current) => ({
      ...createInitialFormState(current.assetSymbol),
      type: current.type,
      occurredAt: current.occurredAt,
    }));
    setErrors({});
    setSuccessMessage("交易已保存");
  }

  return (
    <form className="grid gap-4 md:grid-cols-2 xl:grid-cols-4" onSubmit={handleSubmit}>
      <label className="grid gap-2 text-sm font-medium">
        类型
        <select
          className="rounded-md border border-slate-200 px-3 py-2 font-normal outline-none focus:border-slate-400"
          onChange={(event) => updateField("type", event.target.value as "buy" | "sell")}
          value={form.type}
        >
          <option value="buy">买入</option>
          <option value="sell">卖出</option>
        </select>
      </label>

      <label className="grid gap-2 text-sm font-medium">
        资产
        <select
          className="rounded-md border border-slate-200 px-3 py-2 font-normal outline-none focus:border-slate-400"
          onChange={(event) => updateField("assetSymbol", event.target.value)}
          value={form.assetSymbol}
        >
          {ledgerData.assets.map((asset) => (
            <option key={asset.id} value={asset.symbol}>
              {asset.symbol} · {asset.name}
            </option>
          ))}
        </select>
        {errors.assetSymbol ? (
          <span className="text-xs font-normal text-red-700">{errors.assetSymbol}</span>
        ) : null}
      </label>

      <label className="grid gap-2 text-sm font-medium">
        数量
        <input
          className="rounded-md border border-slate-200 px-3 py-2 font-normal outline-none focus:border-slate-400"
          inputMode="decimal"
          onChange={(event) => updateField("quantity", event.target.value)}
          placeholder="0.00016388"
          value={form.quantity}
        />
        {errors.quantity ? (
          <span className="text-xs font-normal text-red-700">{errors.quantity}</span>
        ) : null}
      </label>

      <label className="grid gap-2 text-sm font-medium">
        成交均价
        <input
          className="rounded-md border border-slate-200 px-3 py-2 font-normal outline-none focus:border-slate-400"
          inputMode="decimal"
          onChange={(event) => updateField("price", event.target.value)}
          placeholder="67121.7"
          value={form.price}
        />
        {errors.price ? (
          <span className="text-xs font-normal text-red-700">{errors.price}</span>
        ) : null}
      </label>

      <label className="grid gap-2 text-sm font-medium">
        总金额
        <input
          className="rounded-md border border-slate-200 px-3 py-2 font-normal outline-none focus:border-slate-400"
          inputMode="decimal"
          onChange={(event) => updateField("totalValue", event.target.value)}
          placeholder="11"
          value={form.totalValue}
        />
        {errors.totalValue ? (
          <span className="text-xs font-normal text-red-700">{errors.totalValue}</span>
        ) : null}
      </label>

      <label className="grid gap-2 text-sm font-medium">
        日期
        <input
          className="rounded-md border border-slate-200 px-3 py-2 font-normal outline-none focus:border-slate-400"
          onChange={(event) => updateField("occurredAt", event.target.value)}
          type="date"
          value={form.occurredAt}
        />
        {errors.occurredAt ? (
          <span className="text-xs font-normal text-red-700">{errors.occurredAt}</span>
        ) : null}
      </label>

      <label className="grid gap-2 text-sm font-medium">
        手续费
        <input
          className="rounded-md border border-slate-200 px-3 py-2 font-normal outline-none focus:border-slate-400"
          inputMode="decimal"
          onChange={(event) => updateField("fee", event.target.value)}
          value={form.fee}
        />
        {errors.fee ? (
          <span className="text-xs font-normal text-red-700">{errors.fee}</span>
        ) : null}
      </label>

      <label className="grid gap-2 text-sm font-medium">
        计价货币
        <input
          className="rounded-md border border-slate-200 bg-slate-50 px-3 py-2 font-normal text-slate-600"
          readOnly
          value={currency}
        />
      </label>

      <label className="grid gap-2 text-sm font-medium md:col-span-2 xl:col-span-4">
        备注
        <input
          className="rounded-md border border-slate-200 px-3 py-2 font-normal outline-none focus:border-slate-400"
          onChange={(event) => updateField("note", event.target.value)}
          placeholder="可选"
          value={form.note}
        />
      </label>

      <div className="md:col-span-2 xl:col-span-4">
        <button
          className="rounded-md bg-slate-950 px-4 py-2 text-sm font-medium text-white"
          type="submit"
        >
          保存交易
        </button>
        <div aria-live="polite" className="mt-2 min-h-5 text-sm">
          {errors.form ? (
            <p className="text-red-700">{errors.form}</p>
          ) : successMessage ? (
            <p className="text-emerald-700">{successMessage}</p>
          ) : null}
        </div>
      </div>
    </form>
  );
}
