"use client";

import { useEffect, useRef, useState, type FormEvent, type Ref } from "react";

import type {
  ApplyLedgerActionResult,
  PersistenceStatus,
  PriceWorkspaceDraft,
} from "@/app";
import type {
  LedgerData,
  PriceSnapshot,
  PriceSnapshotDraft,
} from "@/core/models";
import { createValidatedPriceSnapshot } from "./priceSnapshotService";
import type {
  PriceSnapshotValidationError,
  PriceSnapshotValidationField,
} from "@/core/validation";
import {
  captureLedgerTime,
  systemLedgerClock,
  type LedgerClock,
  type LedgerTimeSnapshot,
} from "@/core/shared";

const SUCCESS_FEEDBACK_MS = 4_000;

type PriceFormProps = Readonly<{
  clock?: LedgerClock;
  ledgerData: LedgerData;
  ledgerEpoch?: number;
  mutationVersion?: number;
  persistedVersion?: number;
  persistenceStatus?: PersistenceStatus;
  onPriceSnapshotCreated: (
    priceSnapshot: PriceSnapshot,
    timeSnapshot: LedgerTimeSnapshot,
  ) => ApplyLedgerActionResult;
  draft?: PriceWorkspaceDraft;
  onDraftChange?: (draft: PriceWorkspaceDraft) => void;
  onReset?: (
    preserve: Pick<PriceWorkspaceDraft, "assetSymbol" | "recordedAt">,
  ) => void;
  focusTargetRef?: Ref<HTMLSelectElement>;
}>;

type PriceFormState = PriceWorkspaceDraft;

type PriceFormField = keyof PriceFormState | "form";

const fieldLabels: Record<keyof PriceSnapshotDraft, string> = {
  assetSymbol: "资产",
  price: "当前价格",
  currency: "计价货币",
  recordedAt: "价格日期",
  source: "价格来源",
  binanceProvenance: "Binance 来源证据",
  note: "价格备注",
};

function createInitialFormState(
  assetSymbol: string,
  todayKey: string,
): PriceFormState {
  return {
    assetSymbol,
    price: "",
    recordedAt: todayKey,
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
    case "PRICE_SNAPSHOT_INVALID_BINANCE_PROVENANCE":
    case "PRICE_SNAPSHOT_BINANCE_PROVENANCE_REQUIRED":
      return "Binance 价格来源证据无效";
    case "PRICE_SNAPSHOT_FUTURE_FACT":
      return "价格日期不能晚于今天";
    case "PRICE_SNAPSHOT_UNSUPPORTED_VALUATION_CURRENCY":
      return "当前仅支持 USD/USDT 估值";
    case "PRICE_SNAPSHOT_NEW_FACT_REQUIRES_USDT":
      return "旧 USD 账本只兼容读取；请新建 USDT 账本后再录入";
    case "PRICE_SNAPSHOT_INVALID_INPUT":
      return `${label}不能为空或格式不正确`;
  }
}

export function PriceForm({
  clock = systemLedgerClock,
  ledgerData,
  ledgerEpoch = 0,
  mutationVersion,
  persistedVersion,
  persistenceStatus,
  onPriceSnapshotCreated,
  draft,
  onDraftChange,
  onReset,
  focusTargetRef,
}: PriceFormProps) {
  const defaultAssetSymbol = ledgerData.assets[0]?.symbol ?? "";
  const [localForm, setLocalForm] = useState<PriceFormState>(() =>
    createInitialFormState(
      defaultAssetSymbol,
      captureLedgerTime(clock).todayKey,
    ),
  );
  const form = draft ?? localForm;
  const [errors, setErrors] = useState<
    Partial<Record<PriceFormField, string>>
  >({});
  const [successMessage, setSuccessMessage] = useState("");
  const [pendingMutationVersion, setPendingMutationVersion] = useState<
    number | null
  >(null);
  const pendingResetRef = useRef<
    Pick<PriceWorkspaceDraft, "assetSymbol" | "recordedAt"> | undefined
  >(undefined);

  function commitForm(next: PriceFormState) {
    if (draft && onDraftChange) {
      onDraftChange(next);
      return;
    }
    setLocalForm(next);
  }

  useEffect(() => {
    if (
      ledgerData.assets.some(
        (asset) => asset.symbol === form.assetSymbol,
      )
    ) {
      return;
    }
    commitForm({
      ...form,
      assetSymbol: ledgerData.assets[0]?.symbol ?? "",
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ledgerData.assets]);

  useEffect(() => {
    setPendingMutationVersion(null);
    pendingResetRef.current = undefined;
    setSuccessMessage("");
    if (!draft) {
      setLocalForm(
        createInitialFormState(
          ledgerData.assets[0]?.symbol ?? "",
          captureLedgerTime(clock).todayKey,
        ),
      );
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ledgerEpoch]);

  useEffect(() => {
    if (
      pendingMutationVersion === null ||
      persistedVersion === undefined ||
      persistenceStatus === undefined
    ) {
      return;
    }
    if (
      persistedVersion >= pendingMutationVersion &&
      persistenceStatus === "saved"
    ) {
      const preserve = pendingResetRef.current;
      setPendingMutationVersion(null);
      pendingResetRef.current = undefined;
      if (preserve) {
        if (draft && onReset) {
          onReset(preserve);
        } else {
          setLocalForm({
            ...createInitialFormState(
              preserve.assetSymbol,
              captureLedgerTime(clock).todayKey,
            ),
            recordedAt: preserve.recordedAt,
          });
        }
      }
      setErrors({});
      setSuccessMessage("价格已认证保存");
      return;
    }
    if (persistenceStatus === "error") {
      setSuccessMessage("");
      setErrors((current) => ({
        ...current,
        form: "价格仍在内存中，但尚未保存；请重试保存",
      }));
    }
  }, [
    clock,
    draft,
    onReset,
    pendingMutationVersion,
    persistedVersion,
    persistenceStatus,
  ]);

  useEffect(() => {
    if (!successMessage || successMessage === "正在保存…") return;
    const timeout = setTimeout(
      () => setSuccessMessage(""),
      SUCCESS_FEEDBACK_MS,
    );
    return () => clearTimeout(timeout);
  }, [successMessage]);

  const selectedAsset =
    ledgerData.assets.find((asset) => asset.symbol === form.assetSymbol) ??
    ledgerData.assets[0];
  const currency = selectedAsset?.quoteCurrency ?? "";

  function updateField<Field extends keyof PriceFormState>(
    field: Field,
    value: PriceFormState[Field],
  ) {
    if (pendingMutationVersion !== null) return;
    commitForm({ ...form, [field]: value });
    setErrors((current) => ({ ...current, [field]: undefined, form: undefined }));
    setSuccessMessage("");
  }

  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (pendingMutationVersion !== null) return;
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

    const mutationResult = onPriceSnapshotCreated(
      result.priceSnapshot,
      timeSnapshot,
    );

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

    if (
      mutationVersion === undefined ||
      persistedVersion === undefined ||
      persistenceStatus === undefined
    ) {
      setLocalForm({
        ...createInitialFormState(
          form.assetSymbol,
          captureLedgerTime(clock).todayKey,
        ),
        recordedAt: form.recordedAt,
      });
      setErrors({});
      setSuccessMessage("价格已加入账本");
      return;
    }

    pendingResetRef.current = {
      assetSymbol: form.assetSymbol,
      recordedAt: form.recordedAt,
    };
    setErrors({});
    setPendingMutationVersion(mutationVersion + 1);
    setSuccessMessage("正在保存…");
  }

  return (
    <form
      aria-busy={pendingMutationVersion !== null}
      className={`grid gap-4 ${
        successMessage === "价格已认证保存"
          ? "motion-safe:animate-[ledger-save-pop_200ms_ease-out]"
          : ""
      }`}
      onSubmit={handleSubmit}
    >
      <div
        aria-disabled={pendingMutationVersion !== null}
        className={
          pendingMutationVersion === null
            ? "contents"
            : "contents pointer-events-none opacity-75"
        }
      >
      <label className="grid gap-2 text-sm font-medium">
        价格资产
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
        当前价格
        <span className="flex overflow-hidden rounded-md border border-slate-200 bg-white focus-within:border-slate-400">
          <input
            aria-label="当前价格"
            className="min-w-0 flex-1 px-3 py-2 font-normal outline-none"
            inputMode="decimal"
            onChange={(event) => updateField("price", event.target.value)}
            placeholder="70000"
            value={form.price}
          />
          <span
            aria-label={`价格计价货币 ${currency}`}
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
        className="rounded-md bg-slate-950 px-4 py-2 text-sm font-medium text-white disabled:cursor-not-allowed disabled:opacity-50"
        disabled={pendingMutationVersion !== null}
        type="submit"
      >
        {pendingMutationVersion === null ? "保存价格" : "正在保存…"}
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
    </form>
  );
}
