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
  systemLedgerClock,
  type LedgerClock,
  type LedgerTimeSnapshot,
} from "@/core/shared";
import { createValidatedCashEvent } from "./cashEventService";
import {
  projectLedgerCashMutation,
  type CashMutationProjection,
} from "./cashProjection";
import { NegativeCashConfirmationDialog } from "./NegativeCashConfirmationDialog";

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

export function CashEventPanel({
  clock = systemLedgerClock,
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
  const initialTodayKey = captureLedgerTime(clock).todayKey;
  const [type, setType] = useState<CashEventType>("deposit");
  const [amountOrTarget, setAmountOrTarget] = useState("");
  const [occurredAt, setOccurredAt] = useState(initialTodayKey);
  const [note, setNote] = useState("");
  const [error, setError] = useState("");
  const [feedback, setFeedback] = useState("");
  const [pendingRisk, setPendingRisk] = useState<PendingRisk | null>(null);
  const [armedDelete, setArmedDelete] = useState<ArmedDelete | null>(null);
  const [pendingMutationVersion, setPendingMutationVersion] = useState<
    number | null
  >(null);
  const [pendingOperation, setPendingOperation] = useState<"add" | "delete" | null>(null);
  const submitButtonRef = useRef<HTMLButtonElement>(null);
  const lastRiskTriggerRef = useRef<HTMLElement | null>(null);
  const todayKey = captureLedgerTime(clock).todayKey;
  const currentBalance = replayUsdtCash(ledgerData, { asOf: todayKey }).balance;

  useEffect(() => {
    setType("deposit");
    setAmountOrTarget("");
    setOccurredAt(captureLedgerTime(clock).todayKey);
    setNote("");
    setError("");
    setFeedback("");
    setPendingRisk(null);
    setArmedDelete(null);
    setPendingMutationVersion(null);
    setPendingOperation(null);
  }, [clock, ledgerEpoch]);

  useEffect(() => {
    if (pendingMutationVersion === null) return;
    if (persistenceStatus === "error") {
      setError("现金变更仍在内存中，但尚未保存；请重试保存");
      return;
    }
    if (
      persistenceStatus === "saved" &&
      persistedVersion >= pendingMutationVersion
    ) {
      if (pendingOperation === "add") {
        setAmountOrTarget("");
        setNote("");
        setFeedback("现金事实已认证保存");
      } else {
        setFeedback("现金事实已删除");
      }
      setError("");
      setPendingMutationVersion(null);
      setPendingOperation(null);
    }
  }, [pendingMutationVersion, pendingOperation, persistedVersion, persistenceStatus]);

  useEffect(() => {
    if (!feedback.includes("已")) return;
    const timeout = setTimeout(() => setFeedback(""), SUCCESS_FEEDBACK_MS);
    return () => clearTimeout(timeout);
  }, [feedback]);

  function applyAdd(cashEvent: CashEvent, timeSnapshot: LedgerTimeSnapshot) {
    const outcome = onCashEventCreated(cashEvent, timeSnapshot);
    if (outcome !== "applied") {
      setError(outcome === "rejected" ? "账本当前不可写" : "账本未发生变化");
      return;
    }
    setPendingMutationVersion(mutationVersion + 1);
    setPendingOperation("add");
    setFeedback("正在保存现金事实…");
    setError("");
  }

  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!isWritable || pendingMutationVersion !== null) return;
    const timeSnapshot = captureLedgerTime(clock);
    const result = createValidatedCashEvent(
      { type, occurredAt, amountOrTarget, note },
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
      setFeedback("再次点击以确认删除该现金事实");
      return;
    }
    if (
      armedDelete.ledgerEpoch !== ledgerEpoch ||
      armedDelete.mutationVersion !== mutationVersion ||
      armedDelete.persistedVersion !== persistedVersion
    ) {
      setArmedDelete(null);
      setError("账本已变化，请重新检查后再删除");
      return;
    }
    applyDelete(cashEvent.id, timeSnapshot);
  }

  function applyDelete(cashEventId: string, timeSnapshot: LedgerTimeSnapshot) {
    const outcome = onCashEventDeleted(cashEventId, timeSnapshot);
    setArmedDelete(null);
    if (outcome !== "applied") {
      setError(outcome === "rejected" ? "账本当前不可写" : "现金事实已不存在");
      return;
    }
    setPendingMutationVersion(mutationVersion + 1);
    setPendingOperation("delete");
    setFeedback("正在保存删除…");
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
      setError("账本版本已变化，旧确认已失效；请重新提交");
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
      setError("现金结果已变化，旧确认已失效；请重新提交");
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
          <h3 className="font-semibold">USDT 现金</h3>
          <p className="mt-1 text-xs text-[var(--ledger-muted)]">
            现金事实与交易共同重放；负余额允许保存，但必须二次确认。
          </p>
        </div>
        <p className="rounded-full bg-slate-100 px-3 py-1.5 text-sm font-semibold">
          当前 {currentBalance} USDT
        </p>
      </div>

      <form className="grid gap-3 sm:grid-cols-2" onSubmit={handleSubmit}>
        <label className="grid gap-1 text-sm font-medium">
          现金类型
          <select
            className="rounded-md border border-slate-200 px-3 py-2 font-normal"
            disabled={!isWritable || pendingMutationVersion !== null}
            onChange={(event) => {
              setType(event.target.value as CashEventType);
              setError("");
            }}
            value={type}
          >
            <option value="deposit">入金</option>
            <option value="withdrawal">出金</option>
            <option value="external-expense">外部支出</option>
            <option value="balance-adjustment">余额校准</option>
          </select>
        </label>
        <label className="grid gap-1 text-sm font-medium">
          {type === "balance-adjustment" ? "目标余额" : "金额"}
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
          日期
          <input
            className="rounded-md border border-slate-200 px-3 py-2 font-normal"
            disabled={!isWritable || pendingMutationVersion !== null}
            onChange={(event) => setOccurredAt(event.target.value)}
            type="date"
            value={occurredAt}
          />
        </label>
        <label className="grid gap-1 text-sm font-medium">
          备注（可选）
          <input
            className="rounded-md border border-slate-200 px-3 py-2 font-normal"
            disabled={!isWritable || pendingMutationVersion !== null}
            onChange={(event) => setNote(event.target.value)}
            value={note}
          />
        </label>
        {type === "balance-adjustment" && amountOrTarget !== "" ? (
          <p className="text-sm text-slate-600 sm:col-span-2">
            保存时会重新读取当前余额 {currentBalance} USDT，并固定 before／target／adjustment 三项证据。
          </p>
        ) : null}
        <div className="sm:col-span-2">
          <button
            className="rounded-md bg-slate-950 px-4 py-2 text-sm font-medium text-white disabled:opacity-50"
            disabled={!isWritable || pendingMutationVersion !== null}
            ref={submitButtonRef}
            type="submit"
          >
            {pendingOperation === "add" ? "正在保存…" : "保存现金事实"}
          </button>
          <div aria-live="polite" className="mt-2 min-h-5 text-sm">
            {error ? <p className="text-red-700" id="cash-event-error">{error}</p> : null}
            {!error && feedback ? <p className="text-sky-800">{feedback}</p> : null}
          </div>
        </div>
      </form>

      <div>
        <h4 className="text-sm font-semibold">现金事实</h4>
        {ledgerData.cashEvents.length === 0 ? (
          <p className="mt-2 text-sm text-[var(--ledger-muted)]">暂无现金事实。</p>
        ) : (
          <ul className="mt-2 grid gap-2">
            {[...ledgerData.cashEvents].reverse().map((cashEvent) => (
              <li
                className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-slate-200 p-3 text-sm"
                key={cashEvent.id}
              >
                <div className="min-w-0">
                  <p className="font-medium">
                    {cashTypeLabel(cashEvent.type)} · {cashEvent.occurredAt.slice(0, 10)}
                  </p>
                  <p className="mt-1 break-words text-xs text-slate-600">
                    {cashEvent.type === "balance-adjustment"
                      ? `before ${cashEvent.balanceBefore} → target ${cashEvent.targetBalance}；adjustment ${cashEvent.adjustmentAmount} USDT`
                      : `${cashEvent.amount} USDT`}
                    {cashEvent.note ? ` · ${cashEvent.note}` : ""}
                  </p>
                </div>
                <button
                  className="rounded-md border border-red-200 px-3 py-1.5 text-xs font-semibold text-red-700 disabled:opacity-50"
                  disabled={!isWritable || pendingMutationVersion !== null}
                  onClick={(event) => requestDelete(cashEvent, event.currentTarget)}
                  type="button"
                >
                  {armedDelete?.cashEventId === cashEvent.id ? "确认删除" : "删除"}
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>

      {pendingRisk ? (
        <NegativeCashConfirmationDialog
          confirmLabel={pendingRisk.operation === "delete" ? "确认并删除" : "确认并保存"}
          onCancel={() => setPendingRisk(null)}
          onConfirm={confirmNegativeBalance}
          projection={pendingRisk.projection}
          title={pendingRisk.operation === "delete" ? "确认删除后的负现金" : "确认负现金余额"}
          triggerRef={lastRiskTriggerRef}
        />
      ) : null}
    </div>
  );
}

function cashTypeLabel(type: CashEventType): string {
  return {
    deposit: "入金",
    withdrawal: "出金",
    "external-expense": "外部支出",
    "balance-adjustment": "余额校准",
  }[type];
}
