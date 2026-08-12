import type { ComponentPropsWithoutRef } from "react";

export function SurfaceCard({
  className = "",
  children,
  ...props
}: Readonly<ComponentPropsWithoutRef<"section">>) {
  return (
    <section
      className={`rounded-[20px] border border-[var(--ledger-border)] bg-[var(--ledger-surface)] shadow-[var(--ledger-shadow-soft)] ${className}`}
      {...props}
    >
      {children}
    </section>
  );
}
