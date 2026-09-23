"use client";

import type {
  Dispatch,
  SetStateAction,
} from "react";
import type { useLanguage } from "@/ui";



export function SettingsWorkspaceTabBar({
  closeDanger,
  setTab,
  t,
  tab,
}: Readonly<{
  closeDanger: ({ restoreFocus }?: { restoreFocus?: boolean; }) => void;
  setTab: Dispatch<SetStateAction<"market" | "fees" | "danger">>;
  t: ReturnType<typeof useLanguage>["t"];
  tab: "market" | "fees" | "danger";
}>) {
  return (
      <div
        aria-label={t("settings.tabs.ariaLabel")}
        className="grid grid-cols-1 gap-2 rounded-xl border border-[var(--ledger-border)] bg-[var(--ledger-surface-muted)] p-2 sm:grid-cols-3"
        role="tablist"
      >
        {(
          [
            ["market", t("settings.tabs.market")],
            ["fees", t("settings.tabs.fees")],
            ["danger", t("settings.tabs.danger")],
          ] as const
        ).map(([value, label]) => (
          <button
            aria-controls={`settings-panel-${value}`}
            aria-selected={tab === value}
            className={
              tab === value
                ? "rounded-lg bg-white px-4 py-2 text-sm font-semibold text-[var(--ledger-ink)] shadow-sm"
                : "rounded-lg px-4 py-2 text-sm font-medium text-[var(--ledger-muted)]"
            }
            key={value}
            onClick={() => {
              setTab(value);
              if (value !== "danger") closeDanger();
            }}
            role="tab"
            type="button"
          >
            {label}
          </button>
        ))}
      </div>
  );
}
