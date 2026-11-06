/**
 * 这个文件放规则管理共用的表单形状、初始值和检查。
 * 按钮按下后做什么在 `feeRuleManagerActions.ts`。
 * 不显然的决定：平台前后不许有空格；2026-08-10 定（W12 02A 第 5.1 节）。
 * 名字前后也不许有空格，哪天定的查不到（这是猜的，日志里没写，要核。）
 */
import type { LedgerData } from "@/core/models";
import { isNegative, toDecimal } from "@/core/shared";
import type { Translate } from "@/ui";

/** 新建规则表单的五个值：名字、平台、币、类型、数值。 */
export type FormState = {
  name: string;
  platform: string;
  assetSymbol: string;
  type: "fixed" | "percentage";
  value: string;
};

/**
 * 新建规则表单的初始值：名字和平台空着，币选 BTC。
 * 类型是固定金额。
 */
export const initialForm: FormState = {
  name: "",
  platform: "",
  assetSymbol: "BTC",
  type: "fixed",
  value: "",
};


/**
 * 这个函数给新规则造一个账本里没用过的编号。
 * 最多试 3 次，都撞了就返回空。
 * 为什么是 3 次：2026-08-19 定（W14 01B 第 3.5 节）。
 * 浏览器造不出编号时也返回空。
 * 拿到空的一方应显示「编号造不出来」，不保存。
 */
export function createUniqueFeeRuleId(ledgerData: LedgerData): string | undefined {
  const existingIds = new Set(
    [
      ...ledgerData.assets,
      ...ledgerData.trades,
      ...ledgerData.cashEvents,
      ...ledgerData.assetTransfers,
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

/**
 * 这个函数回答：新建规则的表单填得对不对？
 * 对就返回 `null`，不对就返回第一条错误说明。
 * 举例：平台写成「 Binance」（前面带空格）→ 答「平台不合格」。
 * 金额或比例必须是不小于 0 的数。
 */
export function validateForm(form: FormState, t: Translate): string | null {
  if (!form.name || form.name !== form.name.trim()) {
    return t("fees.error.nameInvalid");
  }
  if (!form.platform || form.platform !== form.platform.trim()) {
    return t("fees.error.platformInvalid");
  }
  if (!form.assetSymbol) return t("fees.error.assetRequired");
  if (!isValidNonNegativeDecimal(form.value)) {
    return t("fees.error.valueInvalid");
  }
  return null;
}

/**
 * 这个函数回答：这个文字是不是一个不小于 0 的数？
 * 举例：「0.001」→ 答是；「-1」或「abc」→ 答不是。
 * 不会出错。
 */
export function isValidNonNegativeDecimal(value: string): boolean {
  try {
    toDecimal(value);
    return !isNegative(value);
  } catch {
    return false;
  }
}
