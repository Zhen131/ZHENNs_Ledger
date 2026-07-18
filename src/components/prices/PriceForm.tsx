"use client";

import { useEffect, useState, type FormEvent } from "react";

import type { ApplyLedgerActionResult } from "../../hooks/usePersistentLedger";
import type {
  LedgerData,
  PriceSnapshot,
  PriceSnapshotDraft,
} from "../../models";
import { createValidatedPriceSnapshot } from "../../services/priceSnapshotService";
import type {
  PriceSnapshotValidationError,
  PriceSnapshotValidationField,
} from "../../validators/priceSnapshotValidator";

type PriceFormProps = Readonly<{
  ledgerData: LedgerData;
  onPriceSnapshotCreated: (
    priceSnapshot: PriceSnapshot,
  ) => ApplyLedgerActionResult;
}>;

type PriceFormState = {
  assetSymbol: string;
  price: string;
  recordedAt: string;
  note: string;
};

type PriceFormField = keyof PriceFormState | "form";

const fieldLabels: Record<keyof PriceSnapshotDraft, string> = {
  assetSymbol: "资产",
  price: "当前价格",
  currency: "计价货币",
  recordedAt: "价格日期",
  source: "价格来源",
  note: "价格备注",
};

function createInitialFormState(assetSymbol: string): PriceFormState {
  return {
    assetSymbol,
    price: "",
    recordedAt: "",
    note: "",
  };
}

function toPriceFormField(
  field: PriceSnapshotValidationField,
): PriceFormField {
  switch (field) {
    case "assetSymbol":
    case "price":
    case "recordedAt":
    case "note":
      return field;
    case "input":
    case "currency":
    case "source":
      return "form";
  }
}

function formatValidationError(
  error: PriceSnapshotValidationError,
): string {
  const label = error.field === "input" ? "价格" : fieldLabels[error.field];

  switch (error.code) {
    case "PRICE_SNAPSHOT_ASSET_NOT_FOUND":
      return "请选择账本中已有的资产";
    case "PRICE_SNAPSHOT_INVALID_DECIMAL":
      return "当前价格必须是有效数字";
    case "PRICE_SNAPSHOT_VALUE_MUST_BE_POSITIVE":
      return "当前价格必须大于 0";
    case "PRICE_SNAPSHOT_CURRENCY_MISMATCH":
      return "计价货币与资产设置不一致";
    case "PRICE_SNAPSHOT_INVALID_SOURCE":
      return "价格来源不受支持";
    case "PRICE_SNAPSHOT_INVALID_INPUT":
      return `${label}不能为空或格式不正确`;
  }
}

export function PriceForm({
  ledgerData,
  onPriceSnapshotCreated,
}: PriceFormProps) {
  const defaultAssetSymbol = ledgerData.assets[0]?.symbol ?? "";
  const [form, setForm] = useState<PriceFormState>(() =>
    createInitialFormState(defaultAssetSymbol),
  );
  const [errors, setErrors] = useState<
    Partial<Record<PriceFormField, string>>
  >({});
  const [successMessage, setSuccessMessage] = useState("");

  useEffect(() => {
    setForm((current) => {
      if (
        ledgerData.assets.some(
          (asset) => asset.symbol === current.assetSymbol,
        )
      ) {
        return current;
      }

      return {
        ...current,
        assetSymbol: ledgerData.assets[0]?.symbol ?? "",
      };
    });
  }, [ledgerData.assets]);

  const selectedAsset =
    ledgerData.assets.find((asset) => asset.symbol === form.assetSymbol) ??
    ledgerData.assets[0];
  const currency = selectedAsset?.quoteCurrency ?? "";

  function updateField<Field extends keyof PriceFormState>(
    field: Field,
    value: PriceFormState[Field],
  ) {
    setForm((current) => ({ ...current, [field]: value }));
    setErrors((current) => ({ ...current, [field]: undefined, form: undefined }));
    setSuccessMessage("");
  }

  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();

    const result = createValidatedPriceSnapshot(
      {
        assetSymbol: form.assetSymbol,
        price: form.price,
        currency,
        recordedAt: form.recordedAt,
        source: "manual",
        ...(form.note.trim() === "" ? {} : { note: form.note.trim() }),
      },
      ledgerData,
    );

    if (!result.ok) {
      if (result.kind === "service") {
        setErrors({ form: "系统暂时无法生成价格记录，请稍后重试" });
        return;
      }

      const nextErrors: Partial<Record<PriceFormField, string>> = {};
      for (const error of result.errors) {
        const field = toPriceFormField(error.field);
        nextErrors[field] ??= formatValidationError(error);
      }
      setErrors(nextErrors);
      setSuccessMessage("");
      return;
    }

    const mutationResult = onPriceSnapshotCreated(result.priceSnapshot);

    if (mutationResult !== "applied") {
      setErrors({
        form:
          mutationResult === "rejected"
            ? "账本当前不可写，请稍后重试"
            : "账本未发生变化，请检查输入",
      });
      setSuccessMessage("");
      return;
    }

    setForm((current) => ({
      ...createInitialFormState(current.assetSymbol),
      recordedAt: current.recordedAt,
    }));
    setErrors({});
    setSuccessMessage("价格已加入账本");
  }

  return (
    <form className="grid gap-4" onSubmit={handleSubmit}>
      <label className="grid gap-2 text-sm font-medium">
        价格资产
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
          <span className="text-xs font-normal text-red-700">
            {errors.assetSymbol}
          </span>
        ) : null}
      </label>

      <label className="grid gap-2 text-sm font-medium">
        当前价格
        <input
          className="rounded-md border border-slate-200 px-3 py-2 font-normal outline-none focus:border-slate-400"
          inputMode="decimal"
          onChange={(event) => updateField("price", event.target.value)}
          placeholder="70000"
          value={form.price}
        />
        {errors.price ? (
          <span className="text-xs font-normal text-red-700">{errors.price}</span>
        ) : null}
      </label>

      <label className="grid gap-2 text-sm font-medium">
        价格计价货币
        <input
          className="rounded-md border border-slate-200 bg-slate-50 px-3 py-2 font-normal text-slate-600"
          readOnly
          value={currency}
        />
      </label>

      <label className="grid gap-2 text-sm font-medium">
        价格日期
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
        价格备注
        <input
          className="rounded-md border border-slate-200 px-3 py-2 font-normal outline-none focus:border-slate-400"
          onChange={(event) => updateField("note", event.target.value)}
          placeholder="可选"
          value={form.note}
        />
      </label>

      <button
        className="rounded-md bg-slate-950 px-4 py-2 text-sm font-medium text-white"
        type="submit"
      >
        保存价格
      </button>
      <div aria-live="polite" className="min-h-5 text-sm">
        {errors.form ? (
          <p className="text-red-700">{errors.form}</p>
        ) : successMessage ? (
          <p className="text-emerald-700">{successMessage}</p>
        ) : null}
      </div>
    </form>
  );
}
