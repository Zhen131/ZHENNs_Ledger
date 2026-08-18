"use client";

import { useEffect, useMemo, useState, type FormEvent } from "react";

import type {
  ApplyLedgerActionResult,
  PersistenceStatus,
} from "@/app";
import type { FeeRule, LedgerData } from "@/core/models";
import type { LedgerAction } from "@/core/state";
import { isNegative, toDecimal } from "@/core/shared";
import {
  captureLedgerTime,
  systemLedgerClock,
  type LedgerClock,
} from "@/core/shared";

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

type FormState = {
  name: string;
  platform: string;
  assetSymbol: string;
  type: "fixed" | "percentage";
  value: string;
};

const initialForm: FormState = {
  name: "",
  platform: "",
  assetSymbol: "BTC",
  type: "fixed",
  value: "",
};

const SUCCESS_FEEDBACK_MS = 4_000;

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
    if (pendingVersion === null) return;
    if (
      persistedVersion >= pendingVersion &&
      persistenceStatus === "saved"
    ) {
      setPendingVersion(null);
      setMessage("手续费规则已认证保存");
      return;
    }
    if (persistenceStatus === "error") {
      setPendingVersion(null);
      setMessage("");
      setError("手续费规则仍在内存中，但尚未保存；请重试保存");
    }
  }, [pendingVersion, persistedVersion, persistenceStatus]);

  useEffect(() => {
    if (message !== "手续费规则已认证保存") return;
    const timeout = setTimeout(
      () => setMessage(""),
      SUCCESS_FEEDBACK_MS,
    );
    return () => clearTimeout(timeout);
  }, [message]);

  function apply(action: LedgerAction, pendingMessage: string) {
    setError("");
    setMessage("");
    const result = onAction(action);
    if (result !== "applied") {
      setError(
        result === "rejected"
          ? "账本当前不可写，规则没有变更"
          : "规则没有变更；请检查 ID、状态或版本关系",
      );
      return;
    }
    setPendingVersion(mutationVersion + 1);
    setMessage(pendingMessage);
  }

  function submitNewRule(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const validation = validateForm(form);
    if (validation) {
      setError(validation);
      return;
    }
    const id = createUniqueFeeRuleId(ledgerData);
    if (!id) {
      setError("连续三次未能生成全局唯一的手续费规则 ID");
      return;
    }
    const timestamp = captureLedgerTime(clock).now.toISOString();
    const common = {
      id,
      name: form.name,
      platform: form.platform,
      assetSymbol: form.assetSymbol,
      status: "active" as const,
      currency: "USDT" as const,
      createdAt: timestamp,
      updatedAt: timestamp,
    };
    const feeRule: FeeRule =
      form.type === "fixed"
        ? { ...common, type: "fixed", amount: form.value }
        : { ...common, type: "percentage", rate: form.value };
    apply({ type: "feeRule/add", feeRule }, "手续费规则待保存");
  }

  function replaceRule(rule: FeeRule) {
    const value = revisionValues[rule.id] ?? "";
    if (!isValidNonNegativeDecimal(value)) {
      setError("新版本金额或费率必须是大于等于 0 的十进制数");
      return;
    }
    const id = createUniqueFeeRuleId(ledgerData);
    if (!id) {
      setError("连续三次未能生成全局唯一的手续费规则 ID");
      return;
    }
    const timestamp = captureLedgerTime(clock).now.toISOString();
    const common = {
      id,
      name: rule.name,
      platform: rule.platform,
      assetSymbol: rule.assetSymbol,
      status: "active" as const,
      currency: "USDT" as const,
      createdAt: timestamp,
      updatedAt: timestamp,
      replacesFeeRuleId: rule.id,
    };
    const replacement: FeeRule =
      rule.type === "fixed"
        ? { ...common, type: "fixed", amount: value }
        : { ...common, type: "percentage", rate: value };
    apply(
      {
        type: "feeRule/replace",
        feeRuleId: rule.id,
        replacement,
        deactivatedAt: timestamp,
      },
      "新规则版本待保存",
    );
  }

  function deactivateRule(rule: FeeRule) {
    apply(
      {
        type: "feeRule/deactivate",
        feeRuleId: rule.id,
        deactivatedAt: captureLedgerTime(clock).now.toISOString(),
      },
      "规则停用待保存",
    );
  }

  return (
    <div className="grid gap-5">
      {!isWritable ? (
        <p
          className="rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-900"
          role="status"
        >
          暂不可修改：当前账本只读或文件操作尚未完成。
        </p>
      ) : null}
      {conflicts.length > 0 ? (
        <div className="rounded-md border border-red-300 bg-red-50 px-4 py-3 text-sm text-red-900">
          <p className="font-semibold">存在手续费规则冲突</p>
          {conflicts.map((rules) => (
            <p key={`${rules[0].platform}-${rules[0].assetSymbol}`}>
              {rules[0].platform} + {rules[0].assetSymbol} 有 {rules.length} 条 active
              规则；交易录入不会自动选择。
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
            <h3 className="font-semibold">新增规则版本</h3>
            <p className="mt-1 text-xs text-slate-500">
              历史规则不原地改写；调整费率时创建新版本并停用旧版。
            </p>
          </div>
        ) : null}
        <label className="grid gap-1 text-sm font-medium">
          规则名
          <input
            className="rounded-md border border-slate-200 px-3 py-2 font-normal"
            disabled={!isWritable}
            onChange={(event) => setForm({ ...form, name: event.target.value })}
            value={form.name}
          />
        </label>
        <label className="grid gap-1 text-sm font-medium">
          平台（精确匹配）
          <input
            className="rounded-md border border-slate-200 px-3 py-2 font-normal"
            disabled={!isWritable}
            onChange={(event) => setForm({ ...form, platform: event.target.value })}
            value={form.platform}
          />
        </label>
        <label className="grid gap-1 text-sm font-medium">
          规则资产
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
          规则类型
          <select
            className="rounded-md border border-slate-200 px-3 py-2 font-normal"
            disabled={!isWritable}
            onChange={(event) => setForm({ ...form, type: event.target.value as FormState["type"] })}
            value={form.type}
          >
            <option value="fixed">固定费</option>
            <option value="percentage">成交金额比例</option>
          </select>
        </label>
        <label className="grid gap-1 text-sm font-medium">
          {form.type === "fixed" ? "金额（USDT）" : "小数费率"}
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
          新增手续费规则
        </button>
      </form>

      <div
        className={
          presentation === "settings"
            ? "order-1 grid content-start gap-3"
            : "grid gap-3"
        }
      >
        {presentation === "settings" ? (
          <h3 className="font-semibold">规则历史</h3>
        ) : null}
        {ledgerData.feeRules.length === 0 ? (
          <p className="text-sm text-slate-500">暂无手续费规则。</p>
        ) : ledgerData.feeRules.map((rule) => (
          <article className="min-w-0 break-words rounded-md border border-slate-200 p-3 text-sm" key={rule.id}>
            <p className="font-medium">
              {rule.name} · {rule.platform} + {rule.assetSymbol} · {rule.status}
            </p>
            <p className="mt-1 text-slate-600">
              {rule.type === "fixed"
                ? `固定 ${rule.amount} USDT`
                : `成交金额 × ${rule.rate}`} · ID {rule.id}
            </p>
            <p className="mt-1 text-xs text-slate-500">
              创建 {rule.createdAt}
              {rule.replacesFeeRuleId ? ` · 替代 ${rule.replacesFeeRuleId}` : ""}
              {rule.deactivatedAt ? ` · 停用 ${rule.deactivatedAt}` : ""}
            </p>
            {rule.status === "active" ? (
              <div className="mt-3 flex flex-wrap items-end gap-2">
                <label className="grid gap-1 text-xs font-medium">
                  新版本{rule.type === "fixed" ? "金额" : "费率"}
                  <input
                    aria-label={`${rule.name} 新版本${rule.type === "fixed" ? "金额" : "费率"}`}
                    className="rounded-md border border-slate-200 px-2 py-1 text-sm font-normal"
                    disabled={!isWritable}
                    inputMode="decimal"
                    onChange={(event) => setRevisionValues({ ...revisionValues, [rule.id]: event.target.value })}
                    value={revisionValues[rule.id] ?? ""}
                  />
                </label>
                <button
                  className="rounded-md border border-slate-300 px-3 py-1.5 font-medium disabled:opacity-50"
                  disabled={!isWritable}
                  onClick={() => replaceRule(rule)}
                  type="button"
                >
                  创建新版本并停用旧版
                </button>
                <button
                  className="rounded-md border border-red-300 px-3 py-1.5 font-medium text-red-700 disabled:opacity-50"
                  disabled={!isWritable}
                  onClick={() => deactivateRule(rule)}
                  type="button"
                >
                  停用规则
                </button>
              </div>
            ) : null}
          </article>
        ))}
      </div>
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

function createUniqueFeeRuleId(ledgerData: LedgerData): string | undefined {
  const existingIds = new Set(
    [
      ...ledgerData.assets,
      ...ledgerData.trades,
      ...ledgerData.cashEvents,
      ...ledgerData.priceSnapshots,
      ...ledgerData.feeRules,
    ].map(({ id }) => id),
  );
  for (let attempt = 0; attempt < 3; attempt += 1) {
    let candidate: string;
    try {
      candidate = globalThis.crypto.randomUUID();
    } catch {
      return undefined;
    }
    if (
      candidate.length > 0 &&
      candidate.length <= 128 &&
      candidate.trim() === candidate &&
      !existingIds.has(candidate)
    ) {
      return candidate;
    }
  }
  return undefined;
}

function validateForm(form: FormState): string | null {
  if (!form.name || form.name !== form.name.trim()) {
    return "规则名必须非空且不能有首尾空白";
  }
  if (!form.platform || form.platform !== form.platform.trim()) {
    return "平台必须非空且不能有首尾空白";
  }
  if (!form.assetSymbol) return "请选择资产";
  if (!isValidNonNegativeDecimal(form.value)) {
    return "金额或费率必须是大于等于 0 的十进制数";
  }
  return null;
}

function isValidNonNegativeDecimal(value: string): boolean {
  try {
    toDecimal(value);
    return !isNegative(value);
  } catch {
    return false;
  }
}
