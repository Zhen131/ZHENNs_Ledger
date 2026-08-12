import type { DecimalString, FeeRule } from "@/core/models";
import { multiply, toDecimal } from "@/core/shared";

export type FeeRuleCandidate = Readonly<{
  rule: FeeRule;
  fee: DecimalString;
  currency: "USDT";
  formula: string;
}>;

export type FeeRuleMatchResult =
  | { status: "missing-platform" }
  | { status: "invalid-total-value" }
  | { status: "no-match" }
  | { status: "matched"; candidate: FeeRuleCandidate }
  | { status: "conflict"; candidates: readonly FeeRuleCandidate[] };

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
