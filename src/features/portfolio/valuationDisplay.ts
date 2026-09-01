import { translateDefault } from "@/ui";

export type ValuationDisplay = {
  label: string;
  usesApproximation: boolean;
};

export const USDT_USD_APPROXIMATION_DISCLOSURE = translateDefault(
  "portfolio.valuation.approximationDisclosure",
);

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
