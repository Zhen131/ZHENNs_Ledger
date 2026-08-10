"use client";

import { useEffect, useState, type FormEvent } from "react";

import type {
  ApplyLedgerActionResult,
  PersistenceStatus,
} from "../../hooks/usePersistentLedger";
import type { LedgerData, Trade, TradeDraft } from "../../models";
import { calculateTradeCashImpact } from "../../calculators/tradeCashImpact";
import {
  matchFeeRules,
  type FeeRuleCandidate,
} from "../../services/feeRuleService";
import { createValidatedTrade } from "../../services/tradeService";
import type {
  TradeValidationError,
  TradeValidationField,
} from "../../validators/tradeValidator";
import {
  captureLedgerTime,
  systemLedgerClock,
  type LedgerClock,
  type LedgerTimeSnapshot,
} from "../../utils/ledgerDate";

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
}>;

type TradeFormState = {
  type: "buy" | "sell";
  assetSymbol: string;
  quantity: string;
  price: string;
  totalValue: string;
  occurredAt: string;
  fee: string;
  platform: string;
  note: string;
};

type TradeFormField = keyof TradeFormState | "form";

const fieldLabels: Record<keyof TradeDraft, string> = {
  occurredAt: "日期",
  timePrecision: "时间精度",
  type: "类型",
  assetSymbol: "资产",
  quantity: "数量",
  price: "成交均价",
  totalValue: "成交金额（不含手续费）",
  currency: "计价货币",
  fee: "实际手续费",
  feeCurrency: "手续费币种",
  platform: "平台",
  feeRuleId: "手续费规则",
  note: "备注",
  rawText: "原始文本",
};

function createInitialFormState(assetSymbol: string): TradeFormState {
  return {
    type: "buy",
    assetSymbol,
    quantity: "",
    price: "",
    totalValue: "",
    occurredAt: "",
    fee: "0",
    platform: "",
    note: "",
  };
}

function formatValidationError(error: TradeValidationError): string {
  const label =
    error.field === "input" || error.field === "totalValueTolerance"
      ? "交易"
      : fieldLabels[error.field];

  switch (error.code) {
    case "INVALID_TRADE_TYPE":
      return "请选择买入或卖出";
    case "ASSET_NOT_FOUND":
      return "请选择账本中已有的资产";
    case "INVALID_DECIMAL":
      return `${label}必须是有效数字`;
    case "VALUE_MUST_BE_POSITIVE":
      return `${label}必须大于 0`;
    case "FEE_MUST_BE_NON_NEGATIVE":
      return "实际手续费不能小于 0";
    case "TOTAL_VALUE_MISMATCH":
      return "成交金额与数量 × 成交均价不一致";
    case "INSUFFICIENT_HOLDINGS":
      return "卖出数量超过该时间点的可用持仓";
    case "CURRENCY_MISMATCH":
      return "计价货币与资产或已有交易不一致";
    case "FEE_CURRENCY_MISMATCH":
      return "非零实际手续费必须使用交易计价货币";
    case "NEW_FACT_REQUIRES_USDT":
      return "旧 USD 账本只兼容读取；请新建 USDT 账本后再录入";
    case "FUTURE_FACT":
      return "交易日期不能晚于今天";
    case "UNSUPPORTED_VALUATION_CURRENCY":
      return "当前仅支持 USD/USDT 估值";
    case "INVALID_INPUT":
      return `${label}不能为空或格式不正确`;
  }
}

function toTradeFormField(field: TradeValidationField): TradeFormField {
  switch (field) {
    case "type":
    case "assetSymbol":
    case "quantity":
    case "price":
    case "totalValue":
    case "occurredAt":
    case "fee":
    case "note":
      return field;
    case "input":
    case "totalValueTolerance":
    case "timePrecision":
    case "currency":
    case "feeCurrency":
    case "platform":
    case "feeRuleId":
    case "rawText":
      return "form";
  }
}

export function TradeForm({
  clock = systemLedgerClock,
  ledgerData,
  ledgerEpoch,
  mutationVersion,
  persistedVersion,
  persistenceStatus,
  onTradeCreated,
}: TradeFormProps) {
  const defaultAssetSymbol = ledgerData.assets[0]?.symbol ?? "";
  const [form, setForm] = useState<TradeFormState>(() =>
    createInitialFormState(defaultAssetSymbol),
  );
  const [errors, setErrors] = useState<
    Partial<Record<TradeFormField, string>>
  >({});
  const [successMessage, setSuccessMessage] = useState("");
  const [selectedFeeRuleId, setSelectedFeeRuleId] = useState("");
  const [sourceChangedMessage, setSourceChangedMessage] = useState("");
  const [pendingMutationVersion, setPendingMutationVersion] = useState<
    number | null
  >(null);

  useEffect(() => {
    setForm((current) => {
      if (
        ledgerData.assets.some(
          (asset) => asset.symbol === current.assetSymbol,
        )
      ) {
        return current;
      }

      return {
        ...current,
        assetSymbol: ledgerData.assets[0]?.symbol ?? "",
      };
    });
  }, [ledgerData.assets]);

  useEffect(() => {
    setPendingMutationVersion(null);
    setSuccessMessage("");
    setSelectedFeeRuleId("");
    setSourceChangedMessage("");
  }, [ledgerEpoch]);

  useEffect(() => {
    if (pendingMutationVersion === null) return;
    if (
      persistedVersion >= pendingMutationVersion &&
      persistenceStatus === "saved"
    ) {
      setPendingMutationVersion(null);
      setSuccessMessage("交易已认证保存");
      return;
    }
    if (persistenceStatus === "error") {
      setPendingMutationVersion(null);
      setSuccessMessage("");
      setErrors((current) => ({
        ...current,
        form: "交易仍在内存中，但尚未保存；请重试保存",
      }));
    }
  }, [pendingMutationVersion, persistedVersion, persistenceStatus]);

  const selectedAsset =
    ledgerData.assets.find((asset) => asset.symbol === form.assetSymbol) ??
    ledgerData.assets[0];
  const currency = selectedAsset?.quoteCurrency ?? "";
  const isLegacyUsdAsset = currency === "USD";
  const cashImpactPreview = getCashImpactPreview(form, currency);
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

  function updateField<Field extends keyof TradeFormState>(
    field: Field,
    value: TradeFormState[Field],
  ) {
    setForm((current) => ({ ...current, [field]: value }));
    if (
      (field === "platform" || field === "assetSymbol") &&
      selectedFeeRuleId !== ""
    ) {
      setSelectedFeeRuleId("");
      setSourceChangedMessage(
        "平台或资产已变化：保留实际手续费，来源已转为手填。",
      );
    }
    setErrors((current) => ({ ...current, [field]: undefined, form: undefined }));
    setSuccessMessage("");
  }

  function adoptCandidate(candidate: FeeRuleCandidate) {
    setForm((current) => ({ ...current, fee: candidate.fee }));
    setSelectedFeeRuleId(candidate.rule.id);
    setSourceChangedMessage("");
    setErrors((current) => ({ ...current, fee: undefined, form: undefined }));
    setSuccessMessage("");
  }

  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const timeSnapshot = captureLedgerTime(clock);

    const result = createValidatedTrade(
      {
        occurredAt: form.occurredAt,
        timePrecision: "day",
        type: form.type,
        assetSymbol: form.assetSymbol,
        quantity: form.quantity,
        price: form.price,
        totalValue: form.totalValue,
        currency,
        fee: form.fee,
        feeCurrency: currency,
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
        setErrors({ form: "系统暂时无法生成交易，请稍后重试" });
        return;
      }

      const nextErrors: Partial<Record<TradeFormField, string>> = {};
      for (const error of result.errors) {
        const field = toTradeFormField(error.field);
        nextErrors[field] ??= formatValidationError(error);
      }
      setErrors(nextErrors);
      setSuccessMessage("");
      return;
    }

    const mutationResult = onTradeCreated(result.trade, timeSnapshot);

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

    setForm((current) => ({
      ...createInitialFormState(current.assetSymbol),
      type: current.type,
      occurredAt: current.occurredAt,
      platform: current.platform,
    }));
    setSelectedFeeRuleId("");
    setSourceChangedMessage("");
    setErrors({});
    setPendingMutationVersion(mutationVersion + 1);
    setSuccessMessage("交易待保存");
  }

  return (
    <form className="grid gap-4 md:grid-cols-2 xl:grid-cols-4" onSubmit={handleSubmit}>
      <label className="grid gap-2 text-sm font-medium">
        类型
        <select
          className="rounded-md border border-slate-200 px-3 py-2 font-normal outline-none focus:border-slate-400"
          onChange={(event) => updateField("type", event.target.value as "buy" | "sell")}
          value={form.type}
        >
          <option value="buy">买入</option>
          <option value="sell">卖出</option>
        </select>
      </label>

      <label className="grid gap-2 text-sm font-medium">
        资产
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
        数量
        <input
          className="rounded-md border border-slate-200 px-3 py-2 font-normal outline-none focus:border-slate-400"
          inputMode="decimal"
          onChange={(event) => updateField("quantity", event.target.value)}
          placeholder="0.00016388"
          value={form.quantity}
        />
        {errors.quantity ? (
          <span className="text-xs font-normal text-red-700">{errors.quantity}</span>
        ) : null}
      </label>

      <label className="grid gap-2 text-sm font-medium">
        成交均价
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
        成交金额（不含手续费）
        <input
          className="rounded-md border border-slate-200 px-3 py-2 font-normal outline-none focus:border-slate-400"
          inputMode="decimal"
          onChange={(event) => updateField("totalValue", event.target.value)}
          placeholder="11"
          value={form.totalValue}
        />
        {errors.totalValue ? (
          <span className="text-xs font-normal text-red-700">{errors.totalValue}</span>
        ) : null}
      </label>

      <label className="grid gap-2 text-sm font-medium">
        日期
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
        平台（可选，精确匹配）
        <input
          className="rounded-md border border-slate-200 px-3 py-2 font-normal outline-none focus:border-slate-400"
          onChange={(event) => updateField("platform", event.target.value)}
          placeholder="例如 OKX"
          value={form.platform}
        />
      </label>

      <label className="grid gap-2 text-sm font-medium">
        实际手续费
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

      <div className="rounded-md border border-slate-200 bg-slate-50 p-3 text-sm md:col-span-2 xl:col-span-4">
        <p className="font-medium">手续费来源</p>
        {feeRuleMatch.status === "missing-platform" ? (
          <p className="mt-1 text-slate-600">未填写平台：不猜测规则，实际手续费为手填。</p>
        ) : feeRuleMatch.status === "invalid-total-value" ? (
          <p className="mt-1 text-slate-600">成交金额通过十进制校验后才计算候选。</p>
        ) : feeRuleMatch.status === "no-match" ? (
          <p className="mt-1 text-slate-600">无精确匹配规则：实际手续费为手填。</p>
        ) : feeRuleMatch.status === "conflict" ? (
          <div className="mt-2 grid gap-2">
            <p className="font-medium text-red-700">
              多条 active 规则冲突，系统不会自动选择。
            </p>
            <label className="grid gap-1 font-medium">
              显式选择来源规则
              <select
                className="rounded-md border border-red-200 bg-white px-3 py-2 font-normal"
                onChange={(event) => setSelectedFeeRuleId(event.target.value)}
                value={selectedFeeRuleId}
              >
                <option value="">保持手填</option>
                {feeRuleMatch.candidates.map((candidate) => (
                  <option key={candidate.rule.id} value={candidate.rule.id}>
                    {candidate.rule.name} · {candidate.rule.id} · {candidate.fee} USDT
                  </option>
                ))}
              </select>
            </label>
          </div>
        ) : (
          <p className="mt-1 text-slate-600">找到一条精确规则。</p>
        )}

        {defaultCandidate ? (
          <div className="mt-2 rounded-md border border-sky-200 bg-white p-3">
            <p>
              候选：{defaultCandidate.fee} {defaultCandidate.currency} · {defaultCandidate.rule.name}
              （{defaultCandidate.rule.id}）
            </p>
            <p className="mt-1 text-xs text-slate-500">
              {defaultCandidate.rule.type} · 公式 {defaultCandidate.formula}
            </p>
            <button
              className="mt-2 rounded-md border border-sky-300 px-3 py-1.5 font-medium text-sky-900"
              onClick={() => adoptCandidate(defaultCandidate)}
              type="button"
            >
              {selectedCandidate ? "重新采用当前候选" : "采用此规则候选"}
            </button>
          </div>
        ) : null}

        {candidateWasModified ? (
          <p className="mt-2 font-medium text-amber-800">
            实际手续费已由用户修改；规则仅保留为来源追踪。
          </p>
        ) : null}
        {sourceChangedMessage ? (
          <p className="mt-2 font-medium text-amber-800">{sourceChangedMessage}</p>
        ) : null}
      </div>

      <label className="grid gap-2 text-sm font-medium">
        计价货币
        <input
          className="rounded-md border border-slate-200 bg-slate-50 px-3 py-2 font-normal text-slate-600"
          readOnly
          value={currency}
        />
      </label>

      <label className="grid gap-2 text-sm font-medium md:col-span-2 xl:col-span-4">
        备注
        <input
          className="rounded-md border border-slate-200 px-3 py-2 font-normal outline-none focus:border-slate-400"
          onChange={(event) => updateField("note", event.target.value)}
          placeholder="可选"
          value={form.note}
        />
      </label>

      <div className="md:col-span-2 xl:col-span-4">
        {cashImpactPreview ? (
          <div className="mb-3 rounded-md border border-sky-200 bg-sky-50 px-3 py-2 text-sm text-sky-900">
            <p>成交金额（不含手续费）：{form.totalValue} {currency}</p>
            <p>实际手续费：{form.fee} {currency}</p>
            <p>
              {cashImpactPreview.kind === "buy-outflow"
                ? "买入总支出"
                : "卖出净到账"}
              ：{cashImpactPreview.amount} {cashImpactPreview.currency}
            </p>
            <p>
              来源：{selectedCandidate
                ? `${selectedCandidate.rule.name} · ${selectedCandidate.rule.id}`
                : "手填"}
            </p>
          </div>
        ) : null}
        {isLegacyUsdAsset ? (
          <p className="mb-3 rounded-md border border-amber-300 bg-amber-50 px-3 py-2 text-sm text-amber-900">
            旧 USD 资产只兼容读取，不能新增交易；请新建 USDT 账本后继续录入。
          </p>
        ) : null}
        <button
          className="rounded-md bg-slate-950 px-4 py-2 text-sm font-medium text-white disabled:cursor-not-allowed disabled:opacity-50"
          disabled={isLegacyUsdAsset}
          type="submit"
        >
          保存交易
        </button>
        <div aria-live="polite" className="mt-2 min-h-5 text-sm">
          {errors.form ? (
            <p className="text-red-700">{errors.form}</p>
          ) : successMessage ? (
            <p className={pendingMutationVersion ? "text-sky-800" : "text-emerald-700"}>
              {successMessage}
            </p>
          ) : null}
        </div>
      </div>
    </form>
  );
}

function getCashImpactPreview(
  form: TradeFormState,
  currency: string,
) {
  if (!form.totalValue || !form.fee || !currency) {
    return undefined;
  }
  try {
    const result = calculateTradeCashImpact({
      type: form.type,
      totalValue: form.totalValue,
      currency,
      fee: form.fee,
      feeCurrency: currency,
    });
    return result.ok ? result : undefined;
  } catch {
    return undefined;
  }
}

function getSelectedCandidate(
  match: ReturnType<typeof matchFeeRules>,
  selectedFeeRuleId: string,
): FeeRuleCandidate | undefined {
  if (selectedFeeRuleId === "") return undefined;
  if (match.status === "matched") {
    return match.candidate.rule.id === selectedFeeRuleId
      ? match.candidate
      : undefined;
  }
  if (match.status === "conflict") {
    return match.candidates.find(
      ({ rule }) => rule.id === selectedFeeRuleId,
    );
  }
  return undefined;
}
