/**
 * 这个文件管一件事：按平台和币找规则，算出建议的手续费。
 * 它不管规则怎么新建和停用，那在 `feeRuleManagerActions.ts`；也不管交易表单怎么用建议，那在 trades 功能区。
 * 不显然的决定：规则只给建议，存的是人最后填的数；2026-08-10 定（W12 02A 第 5.3 节）。
 */
import type { DecimalString, FeeRule } from "@/core/models";
import { multiply, toDecimal } from "@/core/shared";

/**
 * 一条规则算出的建议手续费：规则、金额、币种、算式。
 * 币种只有 USDT。
 */
export type FeeRuleCandidate = Readonly<{
  rule: FeeRule;
  fee: DecimalString;
  currency: "USDT";
  formula: string;
}>;

type FeeRuleMatchResult =
  | { status: "missing-platform" }
  | { status: "invalid-total-value" }
  | { status: "no-match" }
  | { status: "matched"; candidate: FeeRuleCandidate }
  | { status: "conflict"; candidates: readonly FeeRuleCandidate[] };

/**
 * 这个函数回答：这个平台和币，有没有正好一条在用的规则？
 * 举例：平台 Binance、币 BTC、成交 6500。
 * 有一条在用的 0.001 比例规则 → 答找到了，建议手续费 6.5。
 * 没填平台、成交金额是负数或写错：不找，直接说明原因。
 * 找到两条以上：答「冲突」，不替人挑。
 * 为什么不挑第一条或最新的：会悄悄用错费率；2026-08-10 定（W12 02A 第 5.3 节）。
 * 平台和币要一字不差，大小写不同也算不同。
 * 不会抛错。
 */
export function matchFeeRules(
  input: Readonly<{
    platform?: string;
    assetSymbol: string;
    totalValue: DecimalString;
  }>,
  feeRules: readonly FeeRule[],
): FeeRuleMatchResult {
  if (input.platform === undefined || input.platform === "") {
    return { status: "missing-platform" };
  }

  try {
    if (toDecimal(input.totalValue).isNegative()) {
      return { status: "invalid-total-value" };
    }
  } catch {
    return { status: "invalid-total-value" };
  }

  const matches = feeRules.filter(
    (rule) =>
      rule.status === "active" &&
      rule.platform === input.platform &&
      rule.assetSymbol === input.assetSymbol,
  );

  if (matches.length === 0) {
    return { status: "no-match" };
  }

  const candidates = matches.map((rule) =>
    calculateFeeRuleCandidate(rule, input.totalValue),
  );
  return candidates.length === 1
    ? { status: "matched", candidate: candidates[0] }
    : { status: "conflict", candidates };
}

/**
 * 这个函数回答：按这条规则，这笔成交该付多少手续费？
 * 固定规则：就是规则里的金额。
 * 比例规则：成交金额乘以比例。
 * 举例：比例 0.001，成交 6500 → 答 6.5，算式「6500 × 0.001」。
 * 举例：固定 5 USDT → 答 5。
 * 不会出错。
 */
export function calculateFeeRuleCandidate(
  rule: FeeRule,
  totalValue: DecimalString,
): FeeRuleCandidate {
  if (rule.type === "fixed") {
    return {
      rule,
      fee: rule.amount,
      currency: rule.currency,
      formula: `${rule.amount} USDT fixed`,
    };
  }

  return {
    rule,
    fee: multiply(totalValue, rule.rate),
    currency: rule.currency,
    formula: `${totalValue} × ${rule.rate}`,
  };
}
