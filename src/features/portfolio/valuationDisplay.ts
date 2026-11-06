/**
 * 这个文件管一件事：总数旁边的计价单位怎么写。
 * 它不算任何金额，金额在 `pnlSummaryService.ts` 和 charts 功能区。
 * 不显然的决定：USD、USDT 混着时只写近似等值，不接汇率；2026-08-09 定（W12 01A 第 6.2 节）。
 */
import { translateDefault } from "@/ui";

/** 计价单位怎么写：一个标签，加上是不是用了近似等值。 */
export type ValuationDisplay = {
  label: string;
  usesApproximation: boolean;
};

/**
 * 「1 USDT ≈ 1 USD」那句说明文字，按默认语言取一次。
 * 混着 USD 和 USDT 时，饼图旁边要显示它。
 */
export const USDT_USD_APPROXIMATION_DISCLOSURE = translateDefault(
  "portfolio.valuation.approximationDisclosure",
);

/**
 * 这个函数回答：这一堆币种合在一起，计价单位写什么？
 * 举例：只有 USDT → 答「USDT」。
 * USD 和 USDT 都有 → 答近似等值的标签。
 * 别的币种不算数；一个都没有时用 `fallback`，默认 USDT。
 * 不会出错。
 */
export function createValuationDisplay(
  currencies: Iterable<string>,
  fallback: "USD" | "USDT" = "USDT",
): ValuationDisplay {
  const supported = new Set(
    Array.from(currencies).filter(
      (currency) => currency === "USD" || currency === "USDT",
    ),
  );

  if (supported.size === 0) {
    return { label: fallback, usesApproximation: false };
  }
  if (supported.size === 1) {
    const label = supported.has("USDT") ? "USDT" : "USD";
    return { label, usesApproximation: false };
  }
  return {
    label: translateDefault("portfolio.valuation.approximationLabel"),
    usesApproximation: true,
  };
}
