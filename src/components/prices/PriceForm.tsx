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
import {
  captureLedgerTime,
  systemLedgerClock,
  type LedgerClock,
  type LedgerTimeSnapshot,
} from "../../utils/ledgerDate";

type PriceFormProps = Readonly<{
  clock?: LedgerClock;
  ledgerData: LedgerData;
  onPriceSnapshotCreated: (
    priceSnapshot: PriceSnapshot,
    timeSnapshot: LedgerTimeSnapshot,
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
  assetSymbol: "Asset",
  price: "Current price",
  currency: "Quote currency",
  recordedAt: "Price date",
  source: "Price source",
  binanceProvenance: "Binance provenance",
  note: "Price note",
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
    case "binanceProvenance":
      return "form";
  }
}

function formatValidationError(
  error: PriceSnapshotValidationError,
): string {
  const label = error.field === "input" ? "Price" : fieldLabels[error.field];

  switch (error.code) {
    case "PRICE_SNAPSHOT_ASSET_NOT_FOUND":
      return "Select an asset already present in the ledger";
    case "PRICE_SNAPSHOT_INVALID_DECIMAL":
      return "Current price must be a valid number";
    case "PRICE_SNAPSHOT_VALUE_MUST_BE_POSITIVE":
      return "Current price must be greater than 0";
    case "PRICE_SNAPSHOT_CURRENCY_MISMATCH":
      return "Quote currency does not match the asset settings";
    case "PRICE_SNAPSHOT_INVALID_SOURCE":
      return "Price source is unsupported";
    case "PRICE_SNAPSHOT_INVALID_BINANCE_PROVENANCE":
    case "PRICE_SNAPSHOT_BINANCE_PROVENANCE_REQUIRED":
      return "Binance price provenance is invalid";
    case "PRICE_SNAPSHOT_FUTURE_FACT":
      return "Price date cannot be later than today";
    case "PRICE_SNAPSHOT_UNSUPPORTED_VALUATION_CURRENCY":
      return "Only USD/USDT valuation is currently supported";
    case "PRICE_SNAPSHOT_INVALID_INPUT":
      return `${label} is required or has an invalid format`;
  }
}

export function PriceForm({
  clock = systemLedgerClock,
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
    const timeSnapshot = captureLedgerTime(clock);

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
      {
        generateId: () => globalThis.crypto.randomUUID(),
        now: () => timeSnapshot.now.toISOString(),
        todayKey: () => timeSnapshot.todayKey,
      },
    );

    if (!result.ok) {
      if (result.kind === "service") {
        setErrors({ form: "The system cannot create a price record right now. Try again later." });
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

    const mutationResult = onPriceSnapshotCreated(
      result.priceSnapshot,
      timeSnapshot,
    );

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
      recordedAt: current.recordedAt,
    }));
    setErrors({});
    setSuccessMessage("Price added to the ledger");
  }

  return (
    <form className="grid gap-4" onSubmit={handleSubmit}>
      <label className="grid gap-2 text-sm font-medium">
        Price asset
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
        Current price
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
        Price quote currency
        <input
          className="rounded-md border border-slate-200 bg-slate-50 px-3 py-2 font-normal text-slate-600"
          readOnly
          value={currency}
        />
      </label>

      <label className="grid gap-2 text-sm font-medium">
        Price date
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
        Price note
        <input
          className="rounded-md border border-slate-200 px-3 py-2 font-normal outline-none focus:border-slate-400"
          onChange={(event) => updateField("note", event.target.value)}
          placeholder="Optional"
          value={form.note}
        />
      </label>

      <button
        className="rounded-md bg-slate-950 px-4 py-2 text-sm font-medium text-white"
        type="submit"
      >
        Save price
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
