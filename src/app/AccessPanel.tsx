import { type ReactNode } from "react";

export function AccessPanel({
  title,
  description,
  children,
}: Readonly<{
  title: string;
  description: string;
  children: ReactNode;
}>) {
  return (
    <main className="flex min-h-screen items-center justify-center bg-[var(--ledger-canvas)] px-4 py-10">
      <section className="w-full max-w-md rounded-[24px] border border-[var(--ledger-border)] bg-[var(--ledger-shell)] p-7 shadow-[var(--ledger-shadow)]">
        <p className="text-xs font-semibold uppercase tracking-[0.18em] text-[var(--ledger-accent-strong)]">
          Zhenn&apos;s Ledger
        </p>
        <h1 className="mt-2 text-2xl font-semibold text-[var(--ledger-ink)]">{title}</h1>
        <p className="mb-6 mt-2 text-sm leading-6 text-[var(--ledger-muted)]">
          {description}
        </p>
        {children}
      </section>
    </main>
  );
}
