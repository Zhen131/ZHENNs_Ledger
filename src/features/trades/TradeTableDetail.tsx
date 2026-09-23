"use client";

import { type ReactNode } from "react";

export function Detail({ label, value }: Readonly<{ label: string; value: ReactNode }>) {
  return (
    <div className="min-w-0">
      <dt className="text-xs font-medium text-[var(--ledger-muted)]">{label}</dt>
      <dd className="mt-1 break-words text-[var(--ledger-ink)]">{value}</dd>
    </div>
  );
}
