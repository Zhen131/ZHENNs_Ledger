"use client";

import { useEffect, useRef, useState, type FormEvent } from "react";

import type {
  ApplyLedgerActionResult,
  PersistenceStatus,
} from "@/app";
import { replayUsdtCash } from "@/core/calculations";
import type { CashEvent, CashEventType, LedgerData } from "@/core/models";
import {
  captureLedgerTime,
  FACT_TIME_ZONE_OPTIONS,
  getLedgerTimeZone,
  systemLedgerClock,
  type LedgerClock,
  type LedgerTimeSnapshot,
} from "@/core/shared";
import {
  getActivityPageCount,
  getActivityPageItems,
} from "@/features/activity";
import { NegativeCashConfirmationDialog } from "./NegativeCashConfirmationDialog";
import { LedgerNumber, useLanguage } from "@/ui";
import type { PendingRisk, ArmedDelete } from "./cashEventPanelHelpers";
import { SUCCESS_FEEDBACK_MS } from "./cashEventPanelHelpers";
import {
  doApplyDelete,
  doConfirmNegativeBalance,
  doHandleSubmit,
  doRequestDelete,
  runCashFormEpochResetEffect,
  runCashPersistenceEffect,
} from "./cashEventPanelActions";
import { CashEventPanelEventList } from "./CashEventPanelEventList";

export function CashEventPanel({
  clock = systemLedgerClock,
  cashBalance,
  ledgerData,
  ledgerEpoch,
  mutationVersion,
  persistedVersion,
  persistenceStatus,
  isWritable,
  onCashEventCreated,
  onCashEventDeleted,
}: Readonly<{
  clock?: LedgerClock;
  cashBalance?: string;
  ledgerData: LedgerData;
  ledgerEpoch: number;
  mutationVersion: number;
  persistedVersion: number;
  persistenceStatus: PersistenceStatus;
  isWritable: boolean;
  onCashEventCreated: (
    cashEvent: CashEvent,
    timeSnapshot: LedgerTimeSnapshot,
  ) => ApplyLedgerActionResult;
  onCashEventDeleted: (
    cashEventId: string,
    timeSnapshot: LedgerTimeSnapshot,
  ) => ApplyLedgerActionResult;
}>) {
  const { t } = useLanguage();
  const certifiedSavedFeedback = t("cash.status.certifiedSaved");
  const deletedFeedback = t("cash.status.deleted");
  const savingAddFeedback = t("cash.status.savingAdd");
  const savingDeleteFeedback = t("cash.status.savingDelete");
  const initialTodayKey = captureLedgerTime(clock).todayKey;
  const [type, setType] = useState<CashEventType>("deposit");
  const [amountOrTarget, setAmountOrTarget] = useState("");
  const [occurredAt, setOccurredAt] = useState(initialTodayKey);
  const [occurredTime, setOccurredTime] = useState("");
  const [occurredTimeZone, setOccurredTimeZone] = useState(
    getLedgerTimeZone(clock),
  );
  const [note, setNote] = useState("");
  const [error, setError] = useState("");
  const [feedback, setFeedback] = useState("");
  const [pendingRisk, setPendingRisk] = useState<PendingRisk | null>(null);
  const [armedDelete, setArmedDelete] = useState<ArmedDelete | null>(null);
  const [pendingMutationVersion, setPendingMutationVersion] = useState<
    number | null
  >(null);
  const [pendingOperation, setPendingOperation] = useState<"add" | "delete" | null>(null);
  const [currentPage, setCurrentPage] = useState(1);
  const submitButtonRef = useRef<HTMLButtonElement>(null);
  const lastRiskTriggerRef = useRef<HTMLElement | null>(null);
  const todayKey = captureLedgerTime(clock).todayKey;
  const currentBalance =
    cashBalance ?? replayUsdtCash(ledgerData, { asOf: todayKey }).balance;
  const orderedCashEvents = [...ledgerData.cashEvents].reverse();
  const totalPages = getActivityPageCount(orderedCashEvents.length);
  const currentPageCashEvents = getActivityPageItems(
    orderedCashEvents,
    currentPage,
  );

  useEffect(() => {
    return runCashFormEpochResetEffect(
      {
        clock,
        setAmountOrTarget,
        setArmedDelete,
        setCurrentPage,
        setError,
        setFeedback,
        setNote,
        setOccurredAt,
        setOccurredTime,
        setOccurredTimeZone,
        setPendingMutationVersion,
        setPendingOperation,
        setPendingRisk,
        setType,
      },
    );
  }, [clock, ledgerEpoch]);

  useEffect(() => {
    setCurrentPage((page) => Math.min(page, totalPages));
  }, [totalPages]);

  useEffect(() => {
    return runCashPersistenceEffect(
      {
        certifiedSavedFeedback,
        deletedFeedback,
        pendingMutationVersion,
        pendingOperation,
        persistedVersion,
        persistenceStatus,
        setAmountOrTarget,
        setError,
        setFeedback,
        setNote,
        setPendingMutationVersion,
        setPendingOperation,
        t,
      },
    );
  }, [certifiedSavedFeedback, deletedFeedback, pendingMutationVersion, pendingOperation, persistedVersion, persistenceStatus, t]);

  useEffect(() => {
    if (feedback !== certifiedSavedFeedback && feedback !== deletedFeedback) return;
    const timeout = setTimeout(() => setFeedback(""), SUCCESS_FEEDBACK_MS);
    return () => clearTimeout(timeout);
  }, [certifiedSavedFeedback, deletedFeedback, feedback]);

  function applyAdd(cashEvent: CashEvent, timeSnapshot: LedgerTimeSnapshot) {
    const outcome = onCashEventCreated(cashEvent, timeSnapshot);
    if (outcome !== "applied") {
      setError(outcome === "rejected" ? t("cash.status.ledgerNotWritable") : t("cash.status.unchanged"));
      return;
    }
    setPendingMutationVersion(mutationVersion + 1);
    setPendingOperation("add");
    setFeedback(savingAddFeedback);
    setError("");
  }

  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    return doHandleSubmit(
      {
        amountOrTarget,
        applyAdd,
        clock,
        isWritable,
        lastRiskTriggerRef,
        ledgerData,
        ledgerEpoch,
        mutationVersion,
        note,
        occurredAt,
        occurredTime,
        occurredTimeZone,
        pendingMutationVersion,
        persistedVersion,
        setError,
        setFeedback,
        setPendingRisk,
        submitButtonRef,
        t,
        type,
      },
      event,
    );
  }

  function requestDelete(cashEvent: CashEvent, trigger: HTMLButtonElement) {
    return doRequestDelete(
      {
        applyDelete,
        armedDelete,
        clock,
        isWritable,
        lastRiskTriggerRef,
        ledgerData,
        ledgerEpoch,
        mutationVersion,
        pendingMutationVersion,
        persistedVersion,
        setArmedDelete,
        setError,
        setFeedback,
        setPendingRisk,
        t,
      },
      cashEvent,
      trigger,
    );
  }

  function applyDelete(cashEventId: string, timeSnapshot: LedgerTimeSnapshot) {
    return doApplyDelete(
      {
        mutationVersion,
        onCashEventDeleted,
        savingDeleteFeedback,
        setArmedDelete,
        setError,
        setFeedback,
        setPendingMutationVersion,
        setPendingOperation,
        t,
      },
      cashEventId,
      timeSnapshot,
    );
  }

  function confirmNegativeBalance() {
    return doConfirmNegativeBalance(
      {
        applyAdd,
        applyDelete,
        ledgerData,
        ledgerEpoch,
        mutationVersion,
        pendingRisk,
        persistedVersion,
        setError,
        setPendingRisk,
        t,
      },
    );
  }

  return (
    <div className="grid gap-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h3 className="font-semibold">{t("cash.heading")}</h3>
          <p className="mt-1 text-xs text-[var(--ledger-muted)]">
            {t("cash.description")}
          </p>
        </div>
        <p className="rounded-full bg-slate-100 px-3 py-1.5 text-sm font-semibold">
          {t("cash.currentBalance")} <LedgerNumber kind="money" value={currentBalance} /> USDT
        </p>
      </div>

      <form className="grid gap-3 sm:grid-cols-2" onSubmit={handleSubmit}>
        <label className="grid gap-1 text-sm font-medium">
          {t("cash.field.type")}
          <select
            className="rounded-md border border-slate-200 px-3 py-2 font-normal"
            disabled={!isWritable || pendingMutationVersion !== null}
            onChange={(event) => {
              setType(event.target.value as CashEventType);
              setError("");
            }}
            value={type}
          >
            <option value="deposit">{t("cash.type.deposit")}</option>
            <option value="withdrawal">{t("cash.type.withdrawal")}</option>
            <option value="external-expense">{t("cash.type.externalExpense")}</option>
            <option value="balance-adjustment">{t("cash.type.balanceAdjustment")}</option>
          </select>
        </label>
        <label className="grid gap-1 text-sm font-medium">
          {type === "balance-adjustment" ? t("cash.field.targetBalance") : t("cash.field.amount")}
          <input
            aria-describedby={error ? "cash-event-error" : undefined}
            className="rounded-md border border-slate-200 px-3 py-2 font-normal"
            disabled={!isWritable || pendingMutationVersion !== null}
            inputMode="decimal"
            onChange={(event) => {
              setAmountOrTarget(event.target.value);
              setError("");
            }}
            placeholder={type === "balance-adjustment" ? "800" : "1000"}
            value={amountOrTarget}
          />
        </label>
        <label className="grid gap-1 text-sm font-medium">
          {t("cash.field.date")}
          <input
            className="rounded-md border border-slate-200 px-3 py-2 font-normal"
            disabled={!isWritable || pendingMutationVersion !== null}
            onChange={(event) => setOccurredAt(event.target.value)}
            type="date"
            value={occurredAt}
          />
        </label>
        <label className="grid gap-1 text-sm font-medium">
          {t("cash.field.time")}
          <input
            className="rounded-md border border-slate-200 px-3 py-2 font-normal"
            disabled={!isWritable || pendingMutationVersion !== null}
            onChange={(event) => {
              setOccurredTime(event.target.value);
              setError("");
            }}
            type="time"
            value={occurredTime}
          />
        </label>
        <label className="grid gap-1 text-sm font-medium">
          {t("cash.field.timeZone")}
          <select
            className="rounded-md border border-slate-200 px-3 py-2 font-normal"
            disabled={!isWritable || pendingMutationVersion !== null}
            onChange={(event) => {
              setOccurredTimeZone(event.target.value);
              setError("");
            }}
            value={occurredTimeZone}
          >
            <option value={getLedgerTimeZone(clock)}>
              {t("cash.timeZone.device")}: {getLedgerTimeZone(clock)}
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
        <label className="grid gap-1 text-sm font-medium">
          {t("cash.field.noteOptional")}
          <input
            className="rounded-md border border-slate-200 px-3 py-2 font-normal"
            disabled={!isWritable || pendingMutationVersion !== null}
            onChange={(event) => setNote(event.target.value)}
            value={note}
          />
        </label>
        {type === "balance-adjustment" && amountOrTarget !== "" ? (
          <p className="text-sm text-slate-600 sm:col-span-2">
            {t("cash.adjustment.descriptionPrefix")} <LedgerNumber kind="money" value={currentBalance} /> USDT{t("cash.adjustment.listSeparator")}{t("cash.adjustment.descriptionSuffix")}
          </p>
        ) : null}
        <div className="sm:col-span-2">
          <button
            className="rounded-md bg-slate-950 px-4 py-2 text-sm font-medium text-white disabled:opacity-50"
            disabled={!isWritable || pendingMutationVersion !== null}
            ref={submitButtonRef}
            type="submit"
          >
            {pendingOperation === "add" ? t("cash.status.saving") : t("cash.action.save")}
          </button>
          <div aria-live="polite" className="mt-2 min-h-5 text-sm">
            {error ? <p className="text-red-700" id="cash-event-error">{error}</p> : null}
            {!error && feedback ? <p className="text-sky-800">{feedback}</p> : null}
          </div>
        </div>
      </form>

      <CashEventPanelEventList
        armedDelete={armedDelete}
        currentPage={currentPage}
        currentPageCashEvents={currentPageCashEvents}
        isWritable={isWritable}
        ledgerData={ledgerData}
        orderedCashEvents={orderedCashEvents}
        pendingMutationVersion={pendingMutationVersion}
        requestDelete={requestDelete}
        setCurrentPage={setCurrentPage}
        t={t}
        totalPages={totalPages}
      />

      {pendingRisk ? (
        <NegativeCashConfirmationDialog
          confirmLabel={pendingRisk.operation === "delete" ? t("cash.negativeConfirmation.confirmDelete") : t("cash.negativeConfirmation.defaultConfirm")}
          onCancel={() => setPendingRisk(null)}
          onConfirm={confirmNegativeBalance}
          projection={pendingRisk.projection}
          title={pendingRisk.operation === "delete" ? t("cash.negativeConfirmation.deleteTitle") : t("cash.negativeConfirmation.addTitle")}
          triggerRef={lastRiskTriggerRef}
        />
      ) : null}
    </div>
  );
}
