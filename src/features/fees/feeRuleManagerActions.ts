/**
 * 这个文件管手续费规则管理里每个按钮按下后做什么。
 * 画面在 `FeeRuleManager.tsx` 和它的两个子组件。
 * 不显然的决定：改规则不改原规则，而是新建一版、停用旧版；2026-08-10 定（W12 02A 第 5.2 节）。
 */
import type {
  ApplyLedgerActionResult,
  PersistenceStatus,
} from "@/app";
import type {
  Dispatch,
  FormEvent,
  SetStateAction,
} from "react";
import type { Translate } from "@/ui";
import type { LedgerAction } from "@/core/state";
import type { LedgerClock } from "@/core/shared";
import type { FormState } from "./feeRuleManagerHelpers";
import type {
  FeeRule,
  LedgerData,
} from "@/core/models";
import {
  createUniqueFeeRuleId,
  isValidNonNegativeDecimal,
  validateForm,
} from "./feeRuleManagerHelpers";
import { captureLedgerTime } from "@/core/shared";

type FeeRulePersistenceEffectDeps = {
  certifiedSavedMessage: string;
  pendingVersion: number | null;
  persistedVersion: number;
  persistenceStatus: PersistenceStatus;
  setError: Dispatch<SetStateAction<string>>;
  setMessage: Dispatch<SetStateAction<string>>;
  setPendingVersion: Dispatch<SetStateAction<number | null>>;
  t: Translate;
};

/**
 * 这个函数看存盘结果，决定提示什么。
 * 存到了这次改动的版本：显示「已保存」。
 * 存盘失败：显示「没存上」。
 * 不会出错。
 */
export function runFeeRulePersistenceEffect(
  deps: FeeRulePersistenceEffectDeps,
) {
  const {
    certifiedSavedMessage,
    pendingVersion,
    persistedVersion,
    persistenceStatus,
    setError,
    setMessage,
    setPendingVersion,
    t,
  } = deps;
    if (pendingVersion === null) return;
    if (
      persistedVersion >= pendingVersion &&
      persistenceStatus === "saved"
    ) {
      setPendingVersion(null);
      setMessage(certifiedSavedMessage);
      return;
    }
    if (persistenceStatus === "error") {
      setPendingVersion(null);
      setMessage("");
      setError(t("fees.status.unsaved"));
    }
}

type ApplyDeps = {
  mutationVersion: number;
  onAction: (action: LedgerAction) => ApplyLedgerActionResult;
  setError: Dispatch<SetStateAction<string>>;
  setMessage: Dispatch<SetStateAction<string>>;
  setPendingVersion: Dispatch<SetStateAction<number | null>>;
  t: Translate;
};

/**
 * 这个函数把一个改动交给账本，然后等存盘。
 * 账本不让写、或改动没起作用，就显示错误，不等存盘。
 */
export function doApply(
  deps: ApplyDeps,
  action: LedgerAction,
  pendingMessage: string,
) {
  const {
    mutationVersion,
    onAction,
    setError,
    setMessage,
    setPendingVersion,
    t,
  } = deps;
    setError("");
    setMessage("");
    const result = onAction(action);
    if (result !== "applied") {
      setError(
        result === "rejected"
          ? t("fees.status.ledgerNotWritable")
          : t("fees.status.unchanged"),
      );
      return;
    }
    setPendingVersion(mutationVersion + 1);
    setMessage(pendingMessage);
}

type SubmitNewRuleDeps = {
  apply: (action: LedgerAction, pendingMessage: string) => void;
  clock: LedgerClock;
  form: FormState;
  ledgerData: LedgerData;
  setError: Dispatch<SetStateAction<string>>;
  t: Translate;
};

/**
 * 这个函数处理「新增规则」表单的提交。
 * 先检查表单，再造编号，再交给账本加一条在用的规则。
 * 举例：名字「币安现货」、平台 Binance、币 BTC、比例 0.001。
 * → 账本里多一条在用的比例规则。
 * 表单不对或编号造不出来，显示错误，不改账本。
 */
export function doSubmitNewRule(
  deps: SubmitNewRuleDeps,
  event: FormEvent<HTMLFormElement>,
) {
  const {
    apply,
    clock,
    form,
    ledgerData,
    setError,
    t,
  } = deps;
    event.preventDefault();
    const validation = validateForm(form, t);
    if (validation) {
      setError(validation);
      return;
    }
    const id = createUniqueFeeRuleId(ledgerData);
    if (!id) {
      setError(t("fees.error.idGenerationExhausted"));
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
    apply({ type: "feeRule/add", feeRule }, t("fees.status.pendingAdd"));
}

type ReplaceRuleDeps = {
  apply: (action: LedgerAction, pendingMessage: string) => void;
  clock: LedgerClock;
  ledgerData: LedgerData;
  revisionValues: Record<string, string>;
  setError: Dispatch<SetStateAction<string>>;
  t: Translate;
};

/**
 * 这个函数处理某条规则旁的「改成新版本」。
 * 新建一条同名同平台的新规则，指回旧规则，同时停用旧规则。
 * 举例：旧规则比例 0.001，填 0.00075 → 新规则 0.00075 在用，旧规则停用。
 * 为什么不原地改：旧交易要能查到当时用的哪版；2026-08-10 定（W12 02A 第 5.2 节）。
 * 新值不是不小于 0 的数，或编号造不出来，显示错误，不改账本。
 */
export function doReplaceRule(
  deps: ReplaceRuleDeps,
  rule: FeeRule,
) {
  const {
    apply,
    clock,
    ledgerData,
    revisionValues,
    setError,
    t,
  } = deps;
    const value = revisionValues[rule.id] ?? "";
    if (!isValidNonNegativeDecimal(value)) {
      setError(t("fees.error.revisionInvalid"));
      return;
    }
    const id = createUniqueFeeRuleId(ledgerData);
    if (!id) {
      setError(t("fees.error.idGenerationExhausted"));
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
      t("fees.status.pendingReplace"),
    );
}
