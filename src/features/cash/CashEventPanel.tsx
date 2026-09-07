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
  resolveFactMoment,
  systemLedgerClock,
  type LedgerClock,
  type LedgerTimeSnapshot,
} from "@/core/shared";
import {
  getActivityPageCount,
  getActivityPageItems,
} from "@/features/activity";
import { createValidatedCashEvent } from "./cashEventService";
import {
  projectLedgerCashMutation,
  type CashMutationProjection,
} from "./cashProjection";
import { NegativeCashConfirmationDialog } from "./NegativeCashConfirmationDialog";
import { LedgerNumber, useLanguage } from "@/ui";

type PendingRisk = Readonly<{
  operation: "add" | "delete";
  cashEvent: CashEvent;
  projection: CashMutationProjection;
  ledgerEpoch: number;
  mutationVersion: number;
  persistedVersion: number;
  timeSnapshot: LedgerTimeSnapshot;
}>;

type ArmedDelete = Readonly<{
  cashEventId: string;
  ledgerEpoch: number;
  mutationVersion: number;
  persistedVersion: number;
}>;

const SUCCESS_FEEDBACK_MS = 4_000;
type Translate = ReturnType<typeof useLanguage>["t"];

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
    setType("deposit");
    setAmountOrTarget("");
    setOccurredAt(captureLedgerTime(clock).todayKey);
    setOccurredTime("");
    setOccurredTimeZone(getLedgerTimeZone(clock));
    setNote("");
    setError("");
    setFeedback("");
    setPendingRisk(null);
    setArmedDelete(null);
    setPendingMutationVersion(null);
    setPendingOperation(null);
    setCurrentPage(1);
  }, [clock, ledgerEpoch]);

  useEffect(() => {
    setCurrentPage((page) => Math.min(page, totalPages));
  }, [totalPages]);

  useEffect(() => {
    if (pendingMutationVersion === null) return;
    if (persistenceStatus === "error") {
      setError(t("cash.status.unsaved"));
      return;
    }
    if (
      persistenceStatus === "saved" &&
      persistedVersion >= pendingMutationVersion
    ) {
      if (pendingOperation === "add") {
        setAmountOrTarget("");
        setNote("");
        setFeedback(certifiedSavedFeedback);
      } else {
        setFeedback(deletedFeedback);
      }
      setError("");
      setPendingMutationVersion(null);
      setPendingOperation(null);
    }
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
    event.preventDefault();
    if (!isWritable || pendingMutationVersion !== null) return;
    const timeSnapshot = captureLedgerTime(clock);
    const moment = resolveFactMoment(occurredAt, occurredTime, occurredTimeZone);
    if (!moment.ok) {
      setError(
        t(
          moment.reason === "nonexistent"
            ? "cash.validation.nonexistentWallTime"
            : moment.reason === "ambiguous"
              ? "cash.validation.ambiguousWallTime"
              : "cash.validation.invalidTimeZone",
        ),
      );
      setFeedback("");
      return;
    }
    const result = createValidatedCashEvent(
      { type, ...moment.value, amountOrTarget, note },
      ledgerData,
      {
        generateId: () => globalThis.crypto.randomUUID(),
        now: () => timeSnapshot.now.toISOString(),
        todayKey: () => timeSnapshot.todayKey,
      },
    );
    if (!result.ok) {
      setError(result.error.message);
      setFeedback("");
      return;
    }
    if (result.projection.requiresNegativeBalanceConfirmation) {
      lastRiskTriggerRef.current = submitButtonRef.current;
      setPendingRisk({
        operation: "add",
        cashEvent: result.cashEvent,
        projection: result.projection,
        ledgerEpoch,
        mutationVersion,
        persistedVersion,
        timeSnapshot,
      });
      return;
    }
    applyAdd(result.cashEvent, timeSnapshot);
  }

  function requestDelete(cashEvent: CashEvent, trigger: HTMLButtonElement) {
    if (!isWritable || pendingMutationVersion !== null) return;
    const timeSnapshot = captureLedgerTime(clock);
    const nextLedger = {
      ...ledgerData,
      cashEvents: ledgerData.cashEvents.filter((item) => item.id !== cashEvent.id),
    };
    const projection = projectLedgerCashMutation(
      ledgerData,
      nextLedger,
      timeSnapshot.todayKey,
    );
    if (projection.requiresNegativeBalanceConfirmation) {
      lastRiskTriggerRef.current = trigger;
      setPendingRisk({
        operation: "delete",
        cashEvent,
        projection,
        ledgerEpoch,
        mutationVersion,
        persistedVersion,
        timeSnapshot,
      });
      setArmedDelete(null);
      return;
    }
    if (armedDelete?.cashEventId !== cashEvent.id) {
      setArmedDelete({
        cashEventId: cashEvent.id,
        ledgerEpoch,
        mutationVersion,
        persistedVersion,
      });
      setFeedback(t("cash.status.deleteArmed"));
      return;
    }
    if (
      armedDelete.ledgerEpoch !== ledgerEpoch ||
      armedDelete.mutationVersion !== mutationVersion ||
      armedDelete.persistedVersion !== persistedVersion
    ) {
      setArmedDelete(null);
      setError(t("cash.status.deleteStale"));
      return;
    }
    applyDelete(cashEvent.id, timeSnapshot);
  }

  function applyDelete(cashEventId: string, timeSnapshot: LedgerTimeSnapshot) {
    const outcome = onCashEventDeleted(cashEventId, timeSnapshot);
    setArmedDelete(null);
    if (outcome !== "applied") {
      setError(outcome === "rejected" ? t("cash.status.ledgerNotWritable") : t("cash.status.notFound"));
      return;
    }
    setPendingMutationVersion(mutationVersion + 1);
    setPendingOperation("delete");
    setFeedback(savingDeleteFeedback);
    setError("");
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
      setError(t("cash.status.confirmationStale"));
      return;
    }
    const nextLedger =
      pending.operation === "add"
        ? {
            ...ledgerData,
            cashEvents: [...ledgerData.cashEvents, pending.cashEvent],
          }
        : {
            ...ledgerData,
            cashEvents: ledgerData.cashEvents.filter(
              (item) => item.id !== pending.cashEvent.id,
            ),
          };
    const latestProjection = projectLedgerCashMutation(
      ledgerData,
      nextLedger,
      pending.timeSnapshot.todayKey,
    );
    if (
      !latestProjection.requiresNegativeBalanceConfirmation ||
      latestProjection.nextBalance !== pending.projection.nextBalance
    ) {
      setPendingRisk(null);
      setError(t("cash.status.resultStale"));
      return;
    }
    setPendingRisk(null);
    if (pending.operation === "add") {
      applyAdd(pending.cashEvent, pending.timeSnapshot);
    } else {
      applyDelete(pending.cashEvent.id, pending.timeSnapshot);
    }
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

      <div>
        <h4 className="text-sm font-semibold">{t("cash.events.heading")}</h4>
        {ledgerData.cashEvents.length === 0 ? (
          <p className="mt-2 text-sm text-[var(--ledger-muted)]">{t("cash.events.empty")}</p>
        ) : (
          <>
            <ul className="mt-2 grid gap-2">
              {currentPageCashEvents.map((cashEvent) => (
                <li
                  className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-slate-200 p-3 text-sm"
                  key={cashEvent.id}
                >
                  <div className="min-w-0">
                    <p className="font-medium">
                      {cashTypeLabel(cashEvent.type, t)} · {cashEvent.occurredAt.slice(0, 10)}
                    </p>
                    <p className="mt-1 break-words text-xs text-slate-600">
                      {cashEvent.type === "balance-adjustment" ? (
                        <>
                          before <LedgerNumber kind="money" value={cashEvent.balanceBefore} />{" "}
                          → target <LedgerNumber kind="money" value={cashEvent.targetBalance} />{t("cash.adjustment.semicolonSeparator")}
                          adjustment{" "}
                          <LedgerNumber kind="money" value={cashEvent.adjustmentAmount} /> USDT
                        </>
                      ) : (
                        <><LedgerNumber kind="money" value={cashEvent.amount} /> USDT</>
                      )}
                      {cashEvent.note ? ` · ${cashEvent.note}` : ""}
                    </p>
                  </div>
                  <button
                    className="rounded-md border border-red-200 px-3 py-1.5 text-xs font-semibold text-red-700 disabled:opacity-50"
                    disabled={!isWritable || pendingMutationVersion !== null}
                    onClick={(event) => requestDelete(cashEvent, event.currentTarget)}
                    type="button"
                  >
                    {armedDelete?.cashEventId === cashEvent.id ? t("cash.action.confirmDelete") : t("cash.action.delete")}
                  </button>
                </li>
              ))}
            </ul>
            <div
              aria-label={t("cash.pagination.ariaLabel")}
              className="mt-3 flex flex-wrap items-center justify-between gap-3 border-t border-[var(--ledger-border)] pt-3 text-sm"
            >
              <p className="text-[var(--ledger-muted)]">
                {t("cash.pagination.totalPrefix")} {orderedCashEvents.length} {t("cash.pagination.totalSuffix")}{t("cash.pagination.listSeparator")}{t("cash.pagination.pagePrefix")} {currentPage} / {totalPages} {t("cash.pagination.pageSuffix")}
              </p>
              <div className="flex items-center gap-2">
                <button
                  className="rounded-md border border-[var(--ledger-border)] bg-white px-3 py-2 font-medium text-slate-700 disabled:cursor-not-allowed disabled:opacity-50"
                  disabled={currentPage === 1}
                  onClick={() => setCurrentPage((page) => page - 1)}
                  type="button"
                >
                  {t("cash.pagination.previous")}
                </button>
                <button
                  className="rounded-md border border-[var(--ledger-border)] bg-white px-3 py-2 font-medium text-slate-700 disabled:cursor-not-allowed disabled:opacity-50"
                  disabled={currentPage === totalPages}
                  onClick={() => setCurrentPage((page) => page + 1)}
                  type="button"
                >
                  {t("cash.pagination.next")}
                </button>
              </div>
            </div>
          </>
        )}
      </div>

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

function cashTypeLabel(type: CashEventType, t: Translate): string {
  return {
    deposit: t("cash.type.deposit"),
    withdrawal: t("cash.type.withdrawal"),
    "external-expense": t("cash.type.externalExpense"),
    "balance-adjustment": t("cash.type.balanceAdjustment"),
  }[type];
}
