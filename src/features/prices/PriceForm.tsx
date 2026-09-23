"use client";

import { useEffect, useRef, useState, type FormEvent, type Ref } from "react";

import type {
  ApplyLedgerActionResult,
  PersistenceStatus,
} from "@/app";
import {
  createPriceWorkspaceDraft,
  type PriceWorkspaceDraft,
} from "./priceWorkspaceDraft";
import type { LedgerData, PriceSnapshot } from "@/core/models";
import { createValidatedPriceSnapshot } from "./priceSnapshotService";
import {
  captureLedgerTime,
  FACT_TIME_ZONE_OPTIONS,
  getLedgerTimeZone,
  resolveFactMoment,
  systemLedgerClock,
  type LedgerClock,
  type LedgerTimeSnapshot,
} from "@/core/shared";
import { useLanguage } from "@/ui";
import type { PriceFormState, PriceFormField } from "./priceFormHelpers";
import {
  SUCCESS_FEEDBACK_MS,
  toPriceFormField,
  formatValidationError,
} from "./priceFormHelpers";
import {
  runPriceAssetRepairEffect,
  runPriceEpochResetEffect,
} from "./priceFormEffects";

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
  const { t } = useLanguage();
  const certifiedSavedMessage = t("prices.status.certifiedSaved");
  const savingMessage = t("prices.status.saving");
  const defaultAssetSymbol = ledgerData.assets[0]?.symbol ?? "";
  const [localForm, setLocalForm] = useState<PriceFormState>(() =>
    createPriceWorkspaceDraft(
      defaultAssetSymbol,
      captureLedgerTime(clock).todayKey,
      clock,
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
    return runPriceAssetRepairEffect(
      {
        commitForm,
        form,
        ledgerData,
      },
    );
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ledgerData.assets]);

  useEffect(() => {
    return runPriceEpochResetEffect(
      {
        clock,
        draft,
        ledgerData,
        pendingResetRef,
        setLocalForm,
        setPendingMutationVersion,
        setSuccessMessage,
      },
    );
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
            ...createPriceWorkspaceDraft(
              preserve.assetSymbol,
              captureLedgerTime(clock).todayKey,
              clock,
            ),
            recordedAt: preserve.recordedAt,
          });
        }
      }
      setErrors({});
      setSuccessMessage(certifiedSavedMessage);
      return;
    }
    if (persistenceStatus === "error") {
      setSuccessMessage("");
      setErrors((current) => ({
        ...current,
        form: t("prices.status.unsaved"),
      }));
    }
  }, [
    clock,
    certifiedSavedMessage,
    draft,
    onReset,
    pendingMutationVersion,
    persistedVersion,
    persistenceStatus,
    t,
  ]);

  useEffect(() => {
    if (!successMessage || successMessage === savingMessage) return;
    const timeout = setTimeout(
      () => setSuccessMessage(""),
      SUCCESS_FEEDBACK_MS,
    );
    return () => clearTimeout(timeout);
  }, [savingMessage, successMessage]);

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

    const moment = resolveFactMoment(
      form.recordedAt,
      form.recordedTime,
      form.recordedTimeZone,
    );
    if (!moment.ok) {
      setErrors({
        recordedAt: t(
          moment.reason === "nonexistent"
            ? "prices.validation.nonexistentWallTime"
            : moment.reason === "ambiguous"
              ? "prices.validation.ambiguousWallTime"
              : "prices.validation.invalidTimeZone",
        ),
      });
      setSuccessMessage("");
      return;
    }

    const result = createValidatedPriceSnapshot(
      {
        assetSymbol: form.assetSymbol,
        price: form.price,
        currency,
        recordedAt: moment.value.occurredAt,
        ...(moment.value.occurredTimeZone === undefined
          ? {}
          : { occurredTimeZone: moment.value.occurredTimeZone }),
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
        setErrors({ form: t("prices.status.serviceError") });
        return;
      }

      const nextErrors: Partial<Record<PriceFormField, string>> = {};
      for (const error of result.errors) {
        const field = toPriceFormField(error.field);
        nextErrors[field] ??= formatValidationError(error, t);
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
            ? t("prices.status.ledgerNotWritable")
            : t("prices.status.unchanged"),
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
        ...createPriceWorkspaceDraft(
          form.assetSymbol,
          captureLedgerTime(clock).todayKey,
          clock,
        ),
        recordedAt: form.recordedAt,
      });
      setErrors({});
      setSuccessMessage(t("prices.status.added"));
      return;
    }

    pendingResetRef.current = {
      assetSymbol: form.assetSymbol,
      recordedAt: form.recordedAt,
    };
    setErrors({});
    setPendingMutationVersion(mutationVersion + 1);
    setSuccessMessage(savingMessage);
  }

  return (
    <form
      aria-busy={pendingMutationVersion !== null}
      className={`grid gap-4 ${
        successMessage === certifiedSavedMessage
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
        {t("prices.field.asset")}
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
        {t("prices.field.currentPrice")}
        <span className="flex overflow-hidden rounded-md border border-slate-200 bg-white focus-within:border-slate-400">
          <input
            aria-label={t("prices.field.currentPrice")}
            className="min-w-0 flex-1 px-3 py-2 font-normal outline-none"
            inputMode="decimal"
            onChange={(event) => updateField("price", event.target.value)}
            placeholder="70000"
            value={form.price}
          />
          <span
            aria-label={`${t("prices.field.currencyAriaPrefix")} ${currency}`}
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
        {t("prices.field.date")}
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
        {t("prices.field.time")}
        <input
          className="rounded-md border border-slate-200 px-3 py-2 font-normal outline-none focus:border-slate-400"
          onChange={(event) => updateField("recordedTime", event.target.value)}
          type="time"
          value={form.recordedTime}
        />
      </label>

      <label className="grid gap-2 text-sm font-medium">
        {t("prices.field.timeZone")}
        <select
          className="rounded-md border border-slate-200 px-3 py-2 font-normal outline-none focus:border-slate-400"
          onChange={(event) =>
            updateField("recordedTimeZone", event.target.value)
          }
          value={form.recordedTimeZone}
        >
          <option value={getLedgerTimeZone(clock)}>
            {t("prices.timeZone.device")}: {getLedgerTimeZone(clock)}
          </option>
          {FACT_TIME_ZONE_OPTIONS.filter(
            (timeZone) => timeZone !== getLedgerTimeZone(clock),
          ).map((timeZone) => (
            <option key={timeZone} value={timeZone}>
              {timeZone}
            </option>
          ))}
        </select>
      </label>

      <label className="grid gap-2 text-sm font-medium">
        {t("prices.field.note")}
        <input
          className="rounded-md border border-slate-200 px-3 py-2 font-normal outline-none focus:border-slate-400"
          onChange={(event) => updateField("note", event.target.value)}
          placeholder={t("prices.field.optional")}
          value={form.note}
        />
      </label>

      <button
        className="rounded-md bg-slate-950 px-4 py-2 text-sm font-medium text-white disabled:cursor-not-allowed disabled:opacity-50"
        disabled={pendingMutationVersion !== null}
        type="submit"
      >
        {pendingMutationVersion === null ? t("prices.action.save") : savingMessage}
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
