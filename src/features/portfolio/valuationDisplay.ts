export type ValuationDisplay = {
  label: "USD" | "USDT" | "USD/USDT 近似等值";
  usesApproximation: boolean;
};

export const USDT_USD_APPROXIMATION_DISCLOSURE =
  "1 USDT ≈ 1 USD，未接实时汇率";

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
  return { label: "USD/USDT 近似等值", usesApproximation: true };
}
