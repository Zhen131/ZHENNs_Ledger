"use client";

import type { CashEventType } from "@/core/models";
import {
  FACT_TIME_ZONE_OPTIONS,
  getLedgerTimeZone,
} from "@/core/shared";
import { LedgerNumber } from "@/ui";
import type { LedgerClock } from "@/core/shared";
import type {
  Dispatch,
  FormEvent,
  RefObject,
  SetStateAction,
} from "react";
import type { useLanguage } from "@/ui";

export function CashEventPanelForm({
  amountOrTarget,
  clock,
  currentBalance,
  error,
  feedback,
  handleSubmit,
  isWritable,
  note,
  occurredAt,
  occurredTime,
  occurredTimeZone,
  pendingMutationVersion,
  pendingOperation,
  setAmountOrTarget,
  setError,
  setNote,
  setOccurredAt,
  setOccurredTime,
  setOccurredTimeZone,
  setType,
  submitButtonRef,
  t,
  type,
}: Readonly<{
  amountOrTarget: string;
  clock: LedgerClock;
  currentBalance: string;
  error: string;
  feedback: string;
  handleSubmit: (event: FormEvent<HTMLFormElement>) => void;
  isWritable: boolean;
  note: string;
  occurredAt: string;
  occurredTime: string;
  occurredTimeZone: string;
  pendingMutationVersion: number | null;
  pendingOperation: "add" | "delete" | null;
  setAmountOrTarget: Dispatch<SetStateAction<string>>;
  setError: Dispatch<SetStateAction<string>>;
  setNote: Dispatch<SetStateAction<string>>;
  setOccurredAt: Dispatch<SetStateAction<string>>;
  setOccurredTime: Dispatch<SetStateAction<string>>;
  setOccurredTimeZone: Dispatch<SetStateAction<string>>;
  setType: Dispatch<SetStateAction<CashEventType>>;
  submitButtonRef: RefObject<HTMLButtonElement | null>;
  t: ReturnType<typeof useLanguage>["t"];
  type: CashEventType;
}>) {
  return (
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
  );
}
