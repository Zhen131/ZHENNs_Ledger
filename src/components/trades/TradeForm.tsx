"use client";

import { useEffect, useState, type FormEvent } from "react";

import type { ApplyLedgerActionResult } from "../../hooks/usePersistentLedger";
import type { LedgerData, Trade, TradeDraft } from "../../models";
import { createValidatedTrade } from "../../services/tradeService";
import type {
  TradeValidationError,
  TradeValidationField,
} from "../../validators/tradeValidator";
import {
  captureLedgerTime,
  systemLedgerClock,
  type LedgerClock,
  type LedgerTimeSnapshot,
} from "../../utils/ledgerDate";

type TradeFormProps = Readonly<{
  clock?: LedgerClock;
  ledgerData: LedgerData;
  onTradeCreated: (
    trade: Trade,
    timeSnapshot: LedgerTimeSnapshot,
  ) => ApplyLedgerActionResult;
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
  occurredAt: "Date",
  timePrecision: "Time precision",
  type: "Type",
  assetSymbol: "Asset",
  quantity: "Quantity",
  price: "Average execution price",
  totalValue: "Total amount",
  currency: "Quote currency",
  fee: "Fee",
  feeCurrency: "Fee currency",
  feeRuleId: "Fee rule",
  note: "Note",
  rawText: "Source text",
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
      ? "Trade"
      : fieldLabels[error.field];

  switch (error.code) {
    case "INVALID_TRADE_TYPE":
      return "Select buy or sell";
    case "ASSET_NOT_FOUND":
      return "Select an asset already present in the ledger";
    case "INVALID_DECIMAL":
      return `${label} must be a valid number`;
    case "VALUE_MUST_BE_POSITIVE":
      return `${label} must be greater than 0`;
    case "FEE_MUST_BE_NON_NEGATIVE":
      return "Fee cannot be less than 0";
    case "TOTAL_VALUE_MISMATCH":
      return "Total amount does not match quantity × average execution price";
    case "INSUFFICIENT_HOLDINGS":
      return "Sell quantity exceeds the available position at that time";
    case "CURRENCY_MISMATCH":
      return "Quote currency conflicts with the asset or existing trades";
    case "FUTURE_FACT":
      return "Trade date cannot be later than today";
    case "UNSUPPORTED_VALUATION_CURRENCY":
      return "Only USD/USDT valuation is currently supported";
    case "INVALID_INPUT":
      return `${label} is required or has an invalid format`;
  }
}

function toTradeFormField(field: TradeValidationField): TradeFormField {
  switch (field) {
    case "type":
    case "assetSymbol":
    case "quantity":
    case "price":
    case "totalValue":
    case "occurredAt":
    case "fee":
    case "note":
      return field;
    case "input":
    case "totalValueTolerance":
    case "timePrecision":
    case "currency":
    case "feeCurrency":
    case "feeRuleId":
    case "rawText":
      return "form";
  }
}

export function TradeForm({
  clock = systemLedgerClock,
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
    const timeSnapshot = captureLedgerTime(clock);

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
      {
        generateId: () => globalThis.crypto.randomUUID(),
        now: () => timeSnapshot.now.toISOString(),
        todayKey: () => timeSnapshot.todayKey,
      },
    );

    if (!result.ok) {
      if (result.kind === "service") {
        setErrors({ form: "The system cannot create a trade right now. Try again later." });
        return;
      }

      const nextErrors: Partial<Record<TradeFormField, string>> = {};
      for (const error of result.errors) {
        const field = toTradeFormField(error.field);
        nextErrors[field] ??= formatValidationError(error);
      }
      setErrors(nextErrors);
      setSuccessMessage("");
      return;
    }

    const mutationResult = onTradeCreated(result.trade, timeSnapshot);

    if (mutationResult !== "applied") {
      setErrors({
        form:
          mutationResult === "rejected"
            ? "The ledger is currently read-only. Try again later."
            : "The ledger did not change. Check the input.",
      });
      setSuccessMessage("");
      return;
    }

    setForm((current) => ({
      ...createInitialFormState(current.assetSymbol),
      type: current.type,
      occurredAt: current.occurredAt,
    }));
    setErrors({});
    setSuccessMessage("Trade added to the ledger");
  }

  return (
    <form className="grid gap-4 md:grid-cols-2 xl:grid-cols-4" onSubmit={handleSubmit}>
      <label className="grid gap-2 text-sm font-medium">
        Type
        <select
          className="rounded-md border border-slate-200 px-3 py-2 font-normal outline-none focus:border-slate-400"
          onChange={(event) => updateField("type", event.target.value as "buy" | "sell")}
          value={form.type}
        >
          <option value="buy">Buy</option>
          <option value="sell">Sell</option>
        </select>
      </label>

      <label className="grid gap-2 text-sm font-medium">
        Asset
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
        Quantity
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
        Average execution price
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
        Total amount
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
        Date
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
        Fee
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
        Quote currency
        <input
          className="rounded-md border border-slate-200 bg-slate-50 px-3 py-2 font-normal text-slate-600"
          readOnly
          value={currency}
        />
      </label>

      <label className="grid gap-2 text-sm font-medium md:col-span-2 xl:col-span-4">
        Note
        <input
          className="rounded-md border border-slate-200 px-3 py-2 font-normal outline-none focus:border-slate-400"
          onChange={(event) => updateField("note", event.target.value)}
          placeholder="Optional"
          value={form.note}
        />
      </label>

      <div className="md:col-span-2 xl:col-span-4">
        <button
          className="rounded-md bg-slate-950 px-4 py-2 text-sm font-medium text-white"
          type="submit"
        >
          Save trade
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
