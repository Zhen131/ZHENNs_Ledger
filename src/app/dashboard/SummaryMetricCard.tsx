import type { SummaryMetric } from "@/features/portfolio";
import { LedgerNumber, useLanguage } from "@/ui";

export function SummaryMetricCard({
  label,
  metric,
  valuationLabel,
}: Readonly<{
  label: string;
  metric: SummaryMetric;
  valuationLabel: string;
}>) {
  const { t } = useLanguage();
  return (
    <article className="rounded-md border border-slate-200 bg-slate-50 p-4">
      <h3 className="text-sm font-medium text-slate-600">{label}</h3>
      <p className="mt-2 text-xl font-semibold text-slate-950">
        {metric.value === undefined ? (
          t("dashboard.summaryMetric.incomplete")
        ) : (
          <>
            <LedgerNumber kind="money" value={metric.value} /> {valuationLabel}
          </>
        )}
      </p>
      {metric.missingReasons.length > 0 ? (
        <ul className="mt-2 grid gap-1 text-xs leading-5 text-amber-800">
          {metric.missingReasons.map((reason) => (
            <li key={reason}>{reason}</li>
          ))}
        </ul>
      ) : null}
    </article>
  );
}
