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
import { createValidatedTrade } from "./tradeService";
import {
  captureLedgerTime,
  getLedgerTimeZone,
  FACT_TIME_ZONE_OPTIONS,
  resolveFactMoment,
  systemLedgerClock,
  type LedgerClock,
  type LedgerTimeSnapshot,
} from "@/core/shared";
import {
  NegativeCashConfirmationDialog,
} from "@/features/cash/ui";
import { projectLedgerCashMutation } from "@/features/cash";
import { formatMoney, LedgerNumber, useLanguage } from "@/ui";
import {
  SUCCESS_FEEDBACK_MS,
  formatValidationError,
  toTradeFormField,
  calculateAutomaticTotal,
  getCashImpactPreview,
  getSelectedCandidate,
} from "./tradeFormHelpers";
import type {
  PendingTradeRisk,
  TradeFormState,
  TradeFormField,
} from "./tradeFormTypes";

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
    // The callbacks are intentionally omitted: the asset collection is the
    // only external event that should repair this controlled draft.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ledgerData.assets]);

  useEffect(() => {
    setPendingMutationVersion(null);
    setSuccessState("");
    setSelectedFeeRuleId("");
    setSourceChangedMessage("");
    setPendingRisk(null);
    pendingResetRef.current = undefined;
    if (!draft) {
      setLocalForm(
        createTradeWorkspaceDraft(
          ledgerData.assets[0]?.symbol ?? "",
          captureLedgerTime(clock).todayKey,
          clock,
        ),
      );
    }
    // A new ledger epoch is the only event that resets local form state.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ledgerEpoch]);

  useEffect(() => {
    if (pendingMutationVersion === null) return;
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
            ...createTradeWorkspaceDraft(
              preserve.assetSymbol,
              captureLedgerTime(clock).todayKey,
              clock,
            ),
            platform: preserve.platform,
          });
        }
      }
      setSelectedFeeRuleId("");
      setSourceChangedMessage("");
      setErrors({});
      setSuccessState("certified");
      return;
    }
    if (persistenceStatus === "error") {
      setSuccessState("");
      setErrors((current) => ({
        ...current,
        form: t("trades.form.error.notPersisted"),
      }));
    }
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
    if (pendingMutationVersion !== null) return;
    let next = { ...form, [field]: value };
    if (field === "totalValue") {
      next = { ...next, totalValueMode: "manual" };
    }
    if (
      (field === "quantity" || field === "price") &&
      next.totalValueMode === "auto"
    ) {
      next = {
        ...next,
        totalValue: calculateAutomaticTotal(next.quantity, next.price),
      };
    }
    commitForm(next);
    if (
      (field === "platform" || field === "assetSymbol") &&
      selectedFeeRuleId !== ""
    ) {
      setSelectedFeeRuleId("");
      setSourceChangedMessage(
        t("trades.form.sourceChanged"),
      );
    }
    setErrors((current) => ({ ...current, [field]: undefined, form: undefined }));
    setSuccessState("");
    setPendingRisk(null);
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
    const mutationResult = onTradeCreated(trade, timeSnapshot);

    if (mutationResult !== "applied") {
      setErrors({
        form:
          mutationResult === "rejected"
            ? t("trades.form.error.ledgerNotWritable")
            : t("trades.form.error.ledgerUnchanged"),
      });
      setSuccessState("");
      return;
    }

    pendingResetRef.current = {
      assetSymbol: form.assetSymbol,
      platform: form.platform,
    };
    setErrors({});
    setPendingMutationVersion(mutationVersion + 1);
    setSuccessState("saving");
  }

  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (pendingMutationVersion !== null) return;
    const timeSnapshot = captureLedgerTime(clock);

    const occurredTime = resolveFactMoment(
      form.occurredAt,
      form.occurredTime,
      form.occurredTimeZone,
    );
    if (!occurredTime.ok) {
      const message =
        occurredTime.reason === "nonexistent"
          ? t("trades.form.error.nonexistentWallTime")
          : occurredTime.reason === "ambiguous"
            ? t("trades.form.error.ambiguousWallTime")
            : t("trades.form.error.invalidTimeZone");
      setErrors({ occurredAt: message });
      setSuccessState("");
      return;
    }

    const result = createValidatedTrade(
      {
        ...occurredTime.value,
        type: form.type,
        assetSymbol: form.assetSymbol,
        quantity: form.quantity,
        price: form.price,
        totalValue: form.totalValue,
        currency,
        fee: form.fee,
        feeCurrency,
        ...(form.platform === "" ? {} : { platform: form.platform }),
        ...(selectedCandidate === undefined
          ? {}
          : { feeRuleId: selectedCandidate.rule.id }),
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
        setErrors({ form: t("trades.form.error.serviceUnavailable") });
        return;
      }

      const nextErrors: Partial<Record<TradeFormField, string>> = {};
      for (const error of result.errors) {
        const field = toTradeFormField(error.field);
        nextErrors[field] ??= formatValidationError(error, t);
      }
      setErrors(nextErrors);
      setSuccessState("");
      return;
    }

    const nextLedger = {
      ...ledgerData,
      trades: [...ledgerData.trades, result.trade],
    };
    const projection = projectLedgerCashMutation(
      ledgerData,
      nextLedger,
      timeSnapshot.todayKey,
    );
    if (projection.requiresNegativeBalanceConfirmation) {
      setPendingRisk({
        trade: result.trade,
        projection,
        ledgerEpoch,
        mutationVersion,
        persistedVersion,
        timeSnapshot,
      });
      return;
    }

    applyTrade(result.trade, timeSnapshot);
  }

  function confirmNegativeBalance() {
    const pending = pendingRisk;
    if (!pending) return;
    if (
      pending.ledgerEpoch !== ledgerEpoch ||
      pending.mutationVersion !== mutationVersion ||
      pending.persistedVersion !== persistedVersion
    ) {
      setPendingRisk(null);
      setErrors({ form: t("trades.form.error.ledgerVersionChanged") });
      return;
    }
    const nextLedger = {
      ...ledgerData,
      trades: [...ledgerData.trades, pending.trade],
    };
    const latest = projectLedgerCashMutation(
      ledgerData,
      nextLedger,
      pending.timeSnapshot.todayKey,
    );
    if (
      !latest.requiresNegativeBalanceConfirmation ||
      latest.nextBalance !== pending.projection.nextBalance
    ) {
      setPendingRisk(null);
      setErrors({ form: t("trades.form.error.cashResultChanged") });
      return;
    }
    setPendingRisk(null);
    applyTrade(pending.trade, pending.timeSnapshot);
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

      <div className="md:col-span-2">
        {cashImpactPreview ? (
          <div className="mb-3 rounded-md border border-sky-200 bg-sky-50 px-3 py-2 text-sm text-sky-900">
            <p>
              {t("trades.form.preview.totalValue")}
              <LedgerNumber kind="money" value={form.totalValue} /> {currency}
            </p>
            <p>
              {t("trades.form.preview.actualFee")}
              <LedgerNumber
                kind={feeCurrency === "USDT" ? "money" : "quantity"}
                value={form.fee}
              />{" "}
              {feeCurrency}
            </p>
            <p>
              {t("trades.form.preview.currentCash")}
              <LedgerNumber kind="money" value={cashImpactPreview.currentBalance} /> USDT
            </p>
            <p>
              {t("trades.form.preview.cashDelta")}
              <LedgerNumber kind="money" value={cashImpactPreview.delta} /> USDT
            </p>
            <p>
              {t("trades.form.preview.nextCash")}
              <LedgerNumber kind="money" value={cashImpactPreview.nextBalance} /> USDT
            </p>
            <p>
              {t("trades.form.preview.source")}{selectedCandidate
                ? `${selectedCandidate.rule.name} · ${selectedCandidate.rule.id}`
                : t("trades.form.feeSource.manual")}
            </p>
          </div>
        ) : null}
        <button
          className="rounded-md bg-slate-950 px-4 py-2 text-sm font-medium text-white disabled:cursor-not-allowed disabled:opacity-50"
          disabled={pendingMutationVersion !== null}
          ref={submitButtonRef}
          type="submit"
        >
          {pendingMutationVersion === null ? t("trades.form.action.save") : t("trades.form.action.saving")}
        </button>
        <div aria-live="polite" className="mt-2 min-h-5 text-sm">
          {errors.form ? (
            <p className="text-red-700">{errors.form}</p>
          ) : successState ? (
            <p
              className={
                pendingMutationVersion
                  ? "text-sky-800"
                  : "text-emerald-700 motion-safe:animate-[ledger-feedback-fade_4s_ease-in_forwards]"
              }
            >
              {successState === "certified" ? t("trades.form.success.certified") : t("trades.form.action.saving")}
            </p>
          ) : null}
        </div>
      </div>
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
