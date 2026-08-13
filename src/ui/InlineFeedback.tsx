import type { ReactNode } from "react";

import { LedgerIcon } from "./LedgerIcon";

export type InlineFeedbackTone = "info" | "success" | "warning" | "error";

const TONE_CLASS: Record<InlineFeedbackTone, string> = {
  info: "border-[var(--ledger-border)] bg-[var(--ledger-surface-muted)] text-[var(--ledger-muted)]",
  success: "border-emerald-200 bg-emerald-50 text-emerald-800",
  warning: "border-amber-200 bg-amber-50 text-amber-900",
  error: "border-red-200 bg-red-50 text-red-800",
};

export function InlineFeedback({
  children,
  tone = "info",
}: Readonly<{
  children: ReactNode;
  tone?: InlineFeedbackTone;
}>) {
  return (
    <div
      aria-live={tone === "error" ? "assertive" : "polite"}
      className={`flex items-start gap-2 rounded-xl border px-3 py-2 text-sm leading-5 ${TONE_CLASS[tone]}`}
      role={tone === "error" ? "alert" : "status"}
    >
      <LedgerIcon
        className="mt-0.5 h-4 w-4 shrink-0"
        name={tone === "success" ? "check" : tone === "info" ? "file" : "warning"}
      />
      <span>{children}</span>
    </div>
  );
}
