"use client";

import {
  useEffect,
  useMemo,
  useRef,
  useState,
  type FormEvent,
  type Ref,
} from "react";

import type {
  ApplyLedgerActionResult,
  PersistenceStatus,
} from "@/app";
import {
  createTradeWorkspaceDraft,
  type TradeWorkspaceDraft,
} from "./tradeWorkspaceDraft";
import type { LedgerData, Trade } from "@/core/models";
import { replayUsdtCash } from "@/core/calculations";
import {
  matchFeeRules,
  type FeeRuleCandidate,
} from "@/features/fees";
import {
  captureLedgerTime,
  getLedgerTimeZone,
  FACT_TIME_ZONE_OPTIONS,
  systemLedgerClock,
  type LedgerClock,
  type LedgerTimeSnapshot,
} from "@/core/shared";
import {
  NegativeCashConfirmationDialog,
} from "@/features/cash/ui";
import { formatMoney, LedgerNumber, useLanguage } from "@/ui";
import {
  SUCCESS_FEEDBACK_MS,
  calculateAutomaticTotal,
  getCashImpactPreview,
  getSelectedCandidate,
} from "./tradeFormHelpers";
import type {
  PendingTradeRisk,
  TradeFormState,
  TradeFormField,
} from "./tradeFormTypes";
import {
  runAssetRepairEffect,
  runEpochResetEffect,
  runPendingSaveEffect,
} from "./tradeFormEffects";
import {
  doApplyTrade,
  doConfirmNegativeBalance,
  doHandleSubmit,
  doUpdateField,
} from "./tradeFormActions";
import { TradeFormPreviewAndSubmit } from "./TradeFormPreviewAndSubmit";

type TradeFormProps = Readonly<{
  clock?: LedgerClock;
  ledgerData: LedgerData;
  ledgerEpoch: number;
  mutationVersion: number;
  persistedVersion: number;
  persistenceStatus: PersistenceStatus;
  onTradeCreated: (
    trade: Trade,
    timeSnapshot: LedgerTimeSnapshot,
  ) => ApplyLedgerActionResult;
  draft?: TradeWorkspaceDraft;
  onDraftChange?: (draft: TradeWorkspaceDraft) => void;
  onReset?: (
    preserve: Pick<TradeWorkspaceDraft, "assetSymbol" | "platform">,
  ) => void;
  focusTargetRef?: Ref<HTMLSelectElement>;
}>;

export function TradeForm({
  clock = systemLedgerClock,
  ledgerData,
  ledgerEpoch,
  mutationVersion,
  persistedVersion,
  persistenceStatus,
  onTradeCreated,
  draft,
  onDraftChange,
  onReset,
  focusTargetRef,
}: TradeFormProps) {
  const { t } = useLanguage();
  const defaultAssetSymbol = ledgerData.assets[0]?.symbol ?? "";
  const [localForm, setLocalForm] = useState<TradeFormState>(() =>
    createTradeWorkspaceDraft(
      defaultAssetSymbol,
      captureLedgerTime(clock).todayKey,
      clock,
    ),
  );
  const form = draft ?? localForm;
  const [errors, setErrors] = useState<
    Partial<Record<TradeFormField, string>>
  >({});
  const [successState, setSuccessState] = useState<"" | "certified" | "saving">("");
  const [selectedFeeRuleId, setSelectedFeeRuleId] = useState("");
  const [sourceChangedMessage, setSourceChangedMessage] = useState("");
  const [pendingRisk, setPendingRisk] = useState<PendingTradeRisk | null>(null);
  const [pendingMutationVersion, setPendingMutationVersion] = useState<
    number | null
  >(null);
  const pendingResetRef = useRef<
    Pick<TradeWorkspaceDraft, "assetSymbol" | "platform"> | undefined
  >(undefined);
  const submitButtonRef = useRef<HTMLButtonElement>(null);

  function commitForm(next: TradeFormState) {
    if (draft && onDraftChange) {
      onDraftChange(next);
      return;
    }
    setLocalForm(next);
  }

  useEffect(() => {
    return runAssetRepairEffect(
      {
        commitForm,
        form,
        ledgerData,
      },
    );
    // The callbacks are intentionally omitted: the asset collection is the
    // only external event that should repair this controlled draft.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ledgerData.assets]);

  useEffect(() => {
    return runEpochResetEffect(
      {
        clock,
        draft,
        ledgerData,
        pendingResetRef,
        setLocalForm,
        setPendingMutationVersion,
        setPendingRisk,
        setSelectedFeeRuleId,
        setSourceChangedMessage,
        setSuccessState,
      },
    );
    // A new ledger epoch is the only event that resets local form state.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ledgerEpoch]);

  useEffect(() => {
    return runPendingSaveEffect(
      {
        clock,
        draft,
        onReset,
        pendingMutationVersion,
        pendingResetRef,
        persistedVersion,
        persistenceStatus,
        setErrors,
        setLocalForm,
        setPendingMutationVersion,
        setSelectedFeeRuleId,
        setSourceChangedMessage,
        setSuccessState,
        t,
      },
    );
  }, [
    clock,
    draft,
    onReset,
    pendingMutationVersion,
    persistedVersion,
    persistenceStatus,
    t,
  ]);

  useEffect(() => {
    if (successState !== "certified") return;
    const timeout = setTimeout(
      () => setSuccessState(""),
      SUCCESS_FEEDBACK_MS,
    );
    return () => clearTimeout(timeout);
  }, [successState]);

  const selectedAsset =
    ledgerData.assets.find((asset) => asset.symbol === form.assetSymbol) ??
    ledgerData.assets[0];
  const currency = selectedAsset?.quoteCurrency ?? "";
  const feeCurrency = form.feeCurrency || "USDT";
  const cashAsOf = captureLedgerTime(clock).todayKey;
  const cashBalance = useMemo(
    () => replayUsdtCash(ledgerData, { asOf: cashAsOf }).balance,
    [cashAsOf, ledgerData],
  );
  const cashImpactPreview = getCashImpactPreview(
    form,
    feeCurrency,
    cashBalance,
  );
  const feeRuleMatch = matchFeeRules(
    {
      ...(form.platform === "" ? {} : { platform: form.platform }),
      assetSymbol: form.assetSymbol,
      totalValue: form.totalValue,
    },
    ledgerData.feeRules,
  );
  const selectedCandidate = getSelectedCandidate(
    feeRuleMatch,
    selectedFeeRuleId,
  );
  const defaultCandidate =
    feeRuleMatch.status === "matched"
      ? feeRuleMatch.candidate
      : selectedCandidate;
  const candidateWasModified =
    selectedCandidate !== undefined && form.fee !== selectedCandidate.fee;
  const platformSuggestions = Array.from(
    new Set(
      ledgerData.feeRules
        .map((rule) => rule.platform.trim())
        .filter((platform) => platform !== ""),
    ),
  ).sort((left, right) => (left < right ? -1 : left > right ? 1 : 0));

  function updateField<Field extends keyof TradeFormState>(
    field: Field,
    value: TradeFormState[Field],
  ) {
    return doUpdateField(
      {
        commitForm,
        form,
        pendingMutationVersion,
        selectedFeeRuleId,
        setErrors,
        setPendingRisk,
        setSelectedFeeRuleId,
        setSourceChangedMessage,
        setSuccessState,
        t,
      },
      field,
      value,
    );
  }

  function adoptCandidate(candidate: FeeRuleCandidate) {
    if (pendingMutationVersion !== null) return;
    commitForm({ ...form, fee: candidate.fee, feeCurrency: "USDT" });
    setSelectedFeeRuleId(candidate.rule.id);
    setSourceChangedMessage("");
    setErrors((current) => ({ ...current, fee: undefined, form: undefined }));
    setSuccessState("");
  }

  function applyTrade(
    trade: Trade,
    timeSnapshot: LedgerTimeSnapshot,
  ) {
    return doApplyTrade(
      {
        form,
        mutationVersion,
        onTradeCreated,
        pendingResetRef,
        setErrors,
        setPendingMutationVersion,
        setSuccessState,
        t,
      },
      trade,
      timeSnapshot,
    );
  }

  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    return doHandleSubmit(
      {
        applyTrade,
        clock,
        currency,
        feeCurrency,
        form,
        ledgerData,
        ledgerEpoch,
        mutationVersion,
        pendingMutationVersion,
        persistedVersion,
        selectedCandidate,
        setErrors,
        setPendingRisk,
        setSuccessState,
        t,
      },
      event,
    );
  }

  function confirmNegativeBalance() {
    return doConfirmNegativeBalance(
      {
        applyTrade,
        ledgerData,
        ledgerEpoch,
        mutationVersion,
        pendingRisk,
        persistedVersion,
        setErrors,
        setPendingRisk,
        t,
      },
    );
  }

  return (
    <form
      aria-busy={pendingMutationVersion !== null}
      className={`grid gap-4 md:grid-cols-2 ${
        successState === "certified"
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
        {t("trades.form.field.type")}
        <select
          className="rounded-md border border-slate-200 px-3 py-2 font-normal outline-none focus:border-slate-400"
          onChange={(event) => updateField("type", event.target.value as "buy" | "sell")}
          ref={focusTargetRef}
          value={form.type}
        >
          <option value="buy">{t("trades.type.buy")}</option>
          <option value="sell">{t("trades.type.sell")}</option>
        </select>
      </label>

      <label className="grid gap-2 text-sm font-medium">
        {t("trades.form.field.time")}
        <input
          className="rounded-md border border-slate-200 px-3 py-2 font-normal outline-none focus:border-slate-400"
          onChange={(event) => updateField("occurredTime", event.target.value)}
          type="time"
          value={form.occurredTime}
        />
      </label>

      <label className="grid gap-2 text-sm font-medium">
        {t("trades.form.field.timeZone")}
        <select
          className="rounded-md border border-slate-200 px-3 py-2 font-normal outline-none focus:border-slate-400"
          onChange={(event) => updateField("occurredTimeZone", event.target.value)}
          value={form.occurredTimeZone}
        >
          <option value={getLedgerTimeZone(clock)}>
            {t("trades.form.timeZone.device")}: {getLedgerTimeZone(clock)}
          </option>
          {FACT_TIME_ZONE_OPTIONS.filter((timeZone) => timeZone !== getLedgerTimeZone(clock)).map((timeZone) => (
            <option key={timeZone} value={timeZone}>
              {timeZone}
            </option>
          ))}
        </select>
      </label>

      <label className="grid gap-2 text-sm font-medium">
        {t("trades.form.field.asset")}
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
        {t("trades.form.field.quantity")}
        <input
          className="rounded-md border border-slate-200 px-3 py-2 font-normal outline-none focus:border-slate-400"
          inputMode="decimal"
          onChange={(event) => updateField("quantity", event.target.value)}
          placeholder="0.12345678"
          value={form.quantity}
        />
        {errors.quantity ? (
          <span className="text-xs font-normal text-red-700">{errors.quantity}</span>
        ) : null}
      </label>

      <label className="grid gap-2 text-sm font-medium">
        {t("trades.form.field.averagePrice")}
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

      <label className="grid gap-2 text-sm font-medium">
        {t("trades.form.field.date")}
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
        {t("trades.form.field.platformOptional")}
        <input
          className="rounded-md border border-slate-200 px-3 py-2 font-normal outline-none focus:border-slate-400"
          list="ledger-platform-suggestions"
          onChange={(event) => updateField("platform", event.target.value)}
          placeholder={t("trades.form.platform.placeholder")}
          value={form.platform}
        />
        <datalist id="ledger-platform-suggestions">
          {platformSuggestions.map((platform) => (
            <option key={platform} value={platform} />
          ))}
        </datalist>
      </label>

      <label className="grid gap-2 text-sm font-medium">
        {t("trades.form.field.actualFee")}
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
        {t("trades.form.field.feeCurrency")}
        <select
          className="rounded-md border border-slate-200 px-3 py-2 font-normal outline-none focus:border-slate-400"
          onChange={(event) => updateField("feeCurrency", event.target.value)}
          value={feeCurrency}
        >
          <option value="USDT">USDT</option>
          {ledgerData.assets.map((asset) => (
            <option key={asset.id} value={asset.symbol}>
              {asset.symbol}
            </option>
          ))}
        </select>
      </label>

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

      <label className="grid gap-2 text-sm font-medium">
        {t("trades.form.field.currency")}
        <input
          className="rounded-md border border-slate-200 bg-slate-50 px-3 py-2 font-normal text-slate-600"
          readOnly
          value={currency}
        />
      </label>

      <div className="md:col-span-2">
        {form.noteExpanded || form.note !== "" ? (
          <label className="grid gap-2 text-sm font-medium">
            {t("trades.form.field.note")}
            <input
              className="rounded-md border border-slate-200 px-3 py-2 font-normal outline-none focus:border-slate-400"
              onChange={(event) => updateField("note", event.target.value)}
              placeholder={t("trades.form.note.placeholder")}
              value={form.note}
            />
          </label>
        ) : (
          <button
            className="text-sm font-medium text-[var(--ledger-accent-strong)]"
            onClick={() => updateField("noteExpanded", true)}
            type="button"
          >
            {t("trades.form.note.add")}
          </button>
        )}
      </div>

      <TradeFormPreviewAndSubmit
        cashImpactPreview={cashImpactPreview}
        currency={currency}
        errors={errors}
        feeCurrency={feeCurrency}
        form={form}
        pendingMutationVersion={pendingMutationVersion}
        selectedCandidate={selectedCandidate}
        submitButtonRef={submitButtonRef}
        successState={successState}
        t={t}
      />
      </div>
      {pendingRisk ? (
        <NegativeCashConfirmationDialog
          onCancel={() => setPendingRisk(null)}
          onConfirm={confirmNegativeBalance}
          projection={pendingRisk.projection}
          title={t("trades.form.negativeCash.title")}
          triggerRef={submitButtonRef}
        />
      ) : null}
    </form>
  );
}
