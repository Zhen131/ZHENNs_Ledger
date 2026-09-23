"use client";

import { useEffect, useMemo, useState, type FormEvent } from "react";

import type {
  ApplyLedgerActionResult,
  PersistenceStatus,
} from "@/app";
import type { FeeRule, LedgerData } from "@/core/models";
import type { LedgerAction } from "@/core/state";
import {
  captureLedgerTime,
  systemLedgerClock,
  type LedgerClock,
} from "@/core/shared";
import { useLanguage } from "@/ui";
import type { FormState } from "./feeRuleManagerHelpers";
import {
  initialForm,
  SUCCESS_FEEDBACK_MS,
} from "./feeRuleManagerHelpers";
import {
  doApply,
  doReplaceRule,
  doSubmitNewRule,
  runFeeRulePersistenceEffect,
} from "./feeRuleManagerActions";
import { FeeRuleManagerRuleList } from "./FeeRuleManagerRuleList";

type FeeRuleManagerProps = Readonly<{
  clock?: LedgerClock;
  isWritable: boolean;
  ledgerData: LedgerData;
  ledgerEpoch: number;
  mutationVersion: number;
  persistedVersion: number;
  persistenceStatus: PersistenceStatus;
  onAction: (action: LedgerAction) => ApplyLedgerActionResult;
  presentation?: "legacy" | "settings";
}>;

export function FeeRuleManager({
  clock = systemLedgerClock,
  isWritable,
  ledgerData,
  ledgerEpoch,
  mutationVersion,
  persistedVersion,
  persistenceStatus,
  onAction,
  presentation = "legacy",
}: FeeRuleManagerProps) {
  const { t } = useLanguage();
  const certifiedSavedMessage = t("fees.status.certifiedSaved");
  const [form, setForm] = useState<FormState>(() => ({
    ...initialForm,
    assetSymbol: ledgerData.assets[0]?.symbol ?? "",
  }));
  const [revisionValues, setRevisionValues] = useState<
    Record<string, string>
  >({});
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const [pendingVersion, setPendingVersion] = useState<number | null>(null);

  const conflicts = useMemo(() => {
    const groups = new Map<string, FeeRule[]>();
    for (const rule of ledgerData.feeRules) {
      if (rule.status !== "active") continue;
      const key = `${rule.platform}\u0000${rule.assetSymbol}`;
      groups.set(key, [...(groups.get(key) ?? []), rule]);
    }
    return [...groups.values()].filter((rules) => rules.length > 1);
  }, [ledgerData.feeRules]);

  useEffect(() => {
    setPendingVersion(null);
    setMessage("");
    setError("");
  }, [ledgerEpoch]);

  useEffect(() => {
    return runFeeRulePersistenceEffect(
      {
        certifiedSavedMessage,
        pendingVersion,
        persistedVersion,
        persistenceStatus,
        setError,
        setMessage,
        setPendingVersion,
        t,
      },
    );
  }, [certifiedSavedMessage, pendingVersion, persistedVersion, persistenceStatus, t]);

  useEffect(() => {
    if (message !== certifiedSavedMessage) return;
    const timeout = setTimeout(
      () => setMessage(""),
      SUCCESS_FEEDBACK_MS,
    );
    return () => clearTimeout(timeout);
  }, [certifiedSavedMessage, message]);

  function apply(action: LedgerAction, pendingMessage: string) {
    return doApply(
      {
        mutationVersion,
        onAction,
        setError,
        setMessage,
        setPendingVersion,
        t,
      },
      action,
      pendingMessage,
    );
  }

  function submitNewRule(event: FormEvent<HTMLFormElement>) {
    return doSubmitNewRule(
      {
        apply,
        clock,
        form,
        ledgerData,
        setError,
        t,
      },
      event,
    );
  }

  function replaceRule(rule: FeeRule) {
    return doReplaceRule(
      {
        apply,
        clock,
        ledgerData,
        revisionValues,
        setError,
        t,
      },
      rule,
    );
  }

  function deactivateRule(rule: FeeRule) {
    apply(
      {
        type: "feeRule/deactivate",
        feeRuleId: rule.id,
        deactivatedAt: captureLedgerTime(clock).now.toISOString(),
      },
      t("fees.status.pendingDeactivate"),
    );
  }

  return (
    <div className="grid gap-5">
      {!isWritable ? (
        <p
          className="rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-900"
          role="status"
        >
          {t("fees.readOnlyNotice")}
        </p>
      ) : null}
      {conflicts.length > 0 ? (
        <div className="rounded-md border border-red-300 bg-red-50 px-4 py-3 text-sm text-red-900">
          <p className="font-semibold">{t("fees.conflict.heading")}</p>
          {conflicts.map((rules) => (
            <p key={`${rules[0].platform}-${rules[0].assetSymbol}`}>
              {rules[0].platform} + {rules[0].assetSymbol} {t("fees.conflict.countPrefix")} {rules.length} {t("fees.conflict.countSuffix")}
            </p>
          ))}
        </div>
      ) : null}

      <div
        className={
          presentation === "settings"
            ? "grid min-w-0 gap-5 min-[1100px]:grid-cols-[minmax(260px,.4fr)_minmax(0,.6fr)]"
            : "contents"
        }
      >
      <form
        className={
          presentation === "settings"
            ? "order-2 grid content-start gap-3 rounded-lg border border-slate-200 p-4 md:grid-cols-2"
            : "grid gap-3 md:grid-cols-5"
        }
        onSubmit={submitNewRule}
      >
        {presentation === "settings" ? (
          <div className="md:col-span-2">
            <h3 className="font-semibold">{t("fees.newVersion.heading")}</h3>
            <p className="mt-1 text-xs text-slate-500">
              {t("fees.newVersion.description")}
            </p>
          </div>
        ) : null}
        <label className="grid gap-1 text-sm font-medium">
          {t("fees.field.name")}
          <input
            className="rounded-md border border-slate-200 px-3 py-2 font-normal"
            disabled={!isWritable}
            onChange={(event) => setForm({ ...form, name: event.target.value })}
            value={form.name}
          />
        </label>
        <label className="grid gap-1 text-sm font-medium">
          {t("fees.field.platform")}
          <input
            className="rounded-md border border-slate-200 px-3 py-2 font-normal"
            disabled={!isWritable}
            onChange={(event) => setForm({ ...form, platform: event.target.value })}
            value={form.platform}
          />
        </label>
        <label className="grid gap-1 text-sm font-medium">
          {t("fees.field.asset")}
          <select
            className="rounded-md border border-slate-200 px-3 py-2 font-normal"
            disabled={!isWritable}
            onChange={(event) => setForm({ ...form, assetSymbol: event.target.value })}
            value={form.assetSymbol}
          >
            {ledgerData.assets.map((asset) => (
              <option key={asset.id} value={asset.symbol}>{asset.symbol}</option>
            ))}
          </select>
        </label>
        <label className="grid gap-1 text-sm font-medium">
          {t("fees.field.type")}
          <select
            className="rounded-md border border-slate-200 px-3 py-2 font-normal"
            disabled={!isWritable}
            onChange={(event) => setForm({ ...form, type: event.target.value as FormState["type"] })}
            value={form.type}
          >
            <option value="fixed">{t("fees.type.fixed")}</option>
            <option value="percentage">{t("fees.type.percentage")}</option>
          </select>
        </label>
        <label className="grid gap-1 text-sm font-medium">
          {form.type === "fixed" ? t("fees.field.fixedAmount") : t("fees.field.decimalRate")}
          <input
            className="rounded-md border border-slate-200 px-3 py-2 font-normal"
            disabled={!isWritable}
            inputMode="decimal"
            onChange={(event) => setForm({ ...form, value: event.target.value })}
            value={form.value}
          />
        </label>
        <button
          className="w-fit rounded-md bg-slate-950 px-4 py-2 text-sm font-medium text-white disabled:opacity-50"
          disabled={!isWritable}
          type="submit"
        >
          {t("fees.action.add")}
        </button>
      </form>

      <FeeRuleManagerRuleList
        deactivateRule={deactivateRule}
        isWritable={isWritable}
        ledgerData={ledgerData}
        presentation={presentation}
        replaceRule={replaceRule}
        revisionValues={revisionValues}
        setRevisionValues={setRevisionValues}
        t={t}
      />
      </div>

      <div aria-live="polite" className="min-h-5 text-sm">
        {error ? <p className="text-red-700">{error}</p> : null}
        {!error && message ? (
          <p
            className={
              pendingVersion
                ? "text-sky-800"
                : "text-emerald-700 motion-safe:animate-[ledger-feedback-fade_4s_ease-in_forwards]"
            }
          >
            {message}
          </p>
        ) : null}
      </div>
    </div>
  );
}
