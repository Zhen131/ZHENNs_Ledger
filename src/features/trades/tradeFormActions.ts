/**
 * 这个文件管交易表单上每个动作做什么。
 * 动作有改一栏、保存、确认负余额。
 * 画面在 `TradeForm.tsx` 和它的三个子组件。
 * 不显然的决定：确认框记着账本版本，版本变了就作废；2026-08-19 定（W14 01B 第 6.2 节）。
 */
import type {
  PendingTradeRisk,
  TradeFormField,
  TradeFormState,
} from "./tradeFormTypes";
import type { TradeWorkspaceDraft } from "./tradeWorkspaceDraft";
import type {
  Dispatch,
  FormEvent,
  RefObject,
  SetStateAction,
} from "react";
import type { Translate } from "@/ui";
import {
  calculateAutomaticTotal,
  formatValidationError,
  toTradeFormField,
} from "./tradeFormHelpers";
import type {
  DecimalString,
  FeeRule,
  LedgerData,
  Trade,
} from "@/core/models";
import type {
  LedgerClock,
  LedgerTimeSnapshot,
} from "@/core/shared";
import type { ApplyLedgerActionResult } from "@/app";
import {
  captureLedgerTime,
  resolveFactMoment,
} from "@/core/shared";
import { createValidatedTrade } from "./tradeService";
import { projectLedgerCashMutation } from "@/features/cash";

type UpdateFieldDeps = {
  commitForm: (next: TradeFormState) => void;
  form: TradeWorkspaceDraft;
  pendingMutationVersion: number | null;
  selectedFeeRuleId: string;
  setErrors: Dispatch<SetStateAction<Partial<Record<TradeFormField, string>>>>;
  setPendingRisk: Dispatch<SetStateAction<PendingTradeRisk | null>>;
  setSelectedFeeRuleId: Dispatch<SetStateAction<string>>;
  setSourceChangedMessage: Dispatch<SetStateAction<string>>;
  setSuccessState: Dispatch<SetStateAction<"" | "certified" | "saving">>;
  t: Translate;
};

/**
 * 这个函数处理交易表单里改了一栏。
 * 改数量或单价、且成交金额是自动的：顺手重算成交金额。
 * 人改了成交金额：从此变成手填，不再自动算。
 * 改了平台或币：清掉已选的手续费规则，并提示来源变了。
 * 正在等存盘时，改动不起作用。
 */
export function doUpdateField<Field extends keyof TradeFormState>(
  deps: UpdateFieldDeps,
  field: Field,
  value: TradeFormState[Field],
) {
  const {
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
  } = deps;
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

type ApplyTradeDeps = {
  form: TradeWorkspaceDraft;
  mutationVersion: number;
  onTradeCreated: (trade: Trade, timeSnapshot: LedgerTimeSnapshot) => ApplyLedgerActionResult;
  pendingResetRef: RefObject<Pick<TradeWorkspaceDraft, "assetSymbol" | "platform"> | undefined>;
  setErrors: Dispatch<SetStateAction<Partial<Record<TradeFormField, string>>>>;
  setPendingMutationVersion: Dispatch<SetStateAction<number | null>>;
  setSuccessState: Dispatch<SetStateAction<"" | "certified" | "saving">>;
  t: Translate;
};

/**
 * 这个函数把一笔交易真正加进账本，然后等存盘。
 * 账本不让写或没起作用，显示错误，不等存盘。
 * 存盘后要留下的币和平台先记下来，表单清空时用。
 */
export function doApplyTrade(
  deps: ApplyTradeDeps,
  trade: Trade,
  timeSnapshot: LedgerTimeSnapshot,
) {
  const {
    form,
    mutationVersion,
    onTradeCreated,
    pendingResetRef,
    setErrors,
    setPendingMutationVersion,
    setSuccessState,
    t,
  } = deps;
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

type HandleSubmitDeps = {
  applyTrade: (trade: Trade, timeSnapshot: LedgerTimeSnapshot) => void;
  clock: LedgerClock;
  currency: "USDT";
  feeCurrency: string;
  form: TradeWorkspaceDraft;
  ledgerData: LedgerData;
  ledgerEpoch: number;
  mutationVersion: number;
  pendingMutationVersion: number | null;
  persistedVersion: number;
  selectedCandidate: Readonly<{ rule: FeeRule; fee: DecimalString; currency: "USDT"; formula: string; }> | undefined;
  setErrors: Dispatch<SetStateAction<Partial<Record<TradeFormField, string>>>>;
  setPendingRisk: Dispatch<SetStateAction<PendingTradeRisk | null>>;
  setSuccessState: Dispatch<SetStateAction<"" | "certified" | "saving">>;
  t: Translate;
};

/**
 * 这个函数处理交易表单的「保存」。
 * 先把日期、时间、地点拼成一个时刻，再交给 `createValidatedTrade` 检查。
 * 举例：余额 100，买入成交 6500。
 * → 不直接保存，先弹「余额会变成 -6400」的确认。
 * 余额不会变负就直接加进账本。
 * 检查不过：把错误说明挂到对应的栏旁边。
 */
export function doHandleSubmit(
  deps: HandleSubmitDeps,
  event: FormEvent<HTMLFormElement>,
) {
  const {
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
  } = deps;
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

type ConfirmNegativeBalanceDeps = {
  applyTrade: (trade: Trade, timeSnapshot: LedgerTimeSnapshot) => void;
  ledgerData: LedgerData;
  ledgerEpoch: number;
  mutationVersion: number;
  pendingRisk: PendingTradeRisk | null;
  persistedVersion: number;
  setErrors: Dispatch<SetStateAction<Partial<Record<TradeFormField, string>>>>;
  setPendingRisk: Dispatch<SetStateAction<PendingTradeRisk | null>>;
  t: Translate;
};

/**
 * 这个函数处理负余额确认框里的「确认」。
 * 确认前再算一次余额，结果和弹框时不一样就作废。
 * 账本在弹框后又改过，也作废。
 * 为什么要再算：弹框后账本可能已变；2026-08-19 定（W14 01B 第 6.2 节）。
 */
export function doConfirmNegativeBalance(
  deps: ConfirmNegativeBalanceDeps,
) {
  const {
    applyTrade,
    ledgerData,
    ledgerEpoch,
    mutationVersion,
    pendingRisk,
    persistedVersion,
    setErrors,
    setPendingRisk,
    t,
  } = deps;
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
