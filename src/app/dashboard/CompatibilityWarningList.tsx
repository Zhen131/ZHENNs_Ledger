import type { LedgerCompatibilityWarning } from "@/core/policies";
import { useLanguage } from "@/ui";

export function CompatibilityWarningList({
  compatibilityWarnings,
  t,
}: Readonly<{
  compatibilityWarnings: LedgerCompatibilityWarning[];
  t: ReturnType<typeof useLanguage>["t"];
}>) {
  return (
            <div
              aria-live="assertive"
              className="mb-5 rounded-md border border-amber-300 bg-amber-50 px-4 py-3 text-sm text-amber-950"
            >
              <p className="font-semibold">{t("dashboard.compatibility.heading")}</p>
              <ul className="mt-2 grid gap-1">
                {compatibilityWarnings.slice(0, 8).map((warning, index) => (
                  <li key={`${warning.code}-${warning.path}-${index}`}>
                    <code>{warning.path}</code> · {warning.message}
                  </li>
                ))}
              </ul>
            </div>
  );
}
