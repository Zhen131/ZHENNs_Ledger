"use client";

import type { ReactNode } from "react";

import {
  FileStatusIndicator,
  LedgerIcon,
  type FileStatusTone,
  type LedgerIconName,
} from "@/ui";
import type { LedgerWorkspacePage } from "./useLedgerWorkspaceSession";

const NAV_ITEMS: ReadonlyArray<{
  page: LedgerWorkspacePage;
  label: string;
  icon: LedgerIconName;
}> = [
  { page: "home", label: "首页", icon: "home" },
  { page: "record", label: "记账", icon: "record" },
  { page: "transactions", label: "交易", icon: "transactions" },
  { page: "transfer", label: "导入与导出", icon: "transfer" },
  { page: "settings", label: "设置", icon: "settings" },
];

const PAGE_TITLES: Record<LedgerWorkspacePage, string> = {
  home: "首页",
  record: "记账",
  transactions: "交易",
  transfer: "导入与导出",
  settings: "设置",
};

export function LedgerWorkspaceFrame({
  currentPage,
  onNavigate,
  onLock,
  fileStatusLabel,
  fileStatusTone,
  children,
}: Readonly<{
  currentPage: LedgerWorkspacePage;
  onNavigate: (page: LedgerWorkspacePage) => void;
  onLock?: () => void;
  fileStatusLabel: string;
  fileStatusTone: FileStatusTone;
  children: ReactNode;
}>) {
  return (
    <main className="min-h-screen bg-[var(--ledger-canvas)] p-3 text-[var(--ledger-ink)] sm:p-4">
      <div className="mx-auto flex min-h-[calc(100vh-1.5rem)] w-full max-w-[1500px] overflow-hidden rounded-[24px] border border-[var(--ledger-border)] bg-[var(--ledger-shell)] shadow-[var(--ledger-shadow)] sm:min-h-[calc(100vh-2rem)]">
        <aside className="flex w-48 shrink-0 flex-col border-r border-[var(--ledger-border)] bg-[var(--ledger-surface-muted)] px-3 py-5">
          <div className="px-3">
            <p className="text-[11px] font-semibold uppercase tracking-[0.16em] text-[var(--ledger-accent-strong)]">
              Local-first
            </p>
            <p className="mt-1 text-lg font-semibold tracking-tight">
              Zhenn&apos;s Ledger
            </p>
          </div>

          <nav aria-label="账本主导航" className="mt-8 grid gap-1.5">
            {NAV_ITEMS.map((item) => {
              const active = currentPage === item.page;
              return (
                <button
                  aria-current={active ? "page" : undefined}
                  className={
                    active
                      ? "flex items-center gap-3 rounded-xl bg-[var(--ledger-accent-soft)] px-3 py-2.5 text-left text-sm font-semibold text-[var(--ledger-accent-strong)]"
                      : "flex items-center gap-3 rounded-xl px-3 py-2.5 text-left text-sm font-medium text-[var(--ledger-muted)] hover:bg-white hover:text-[var(--ledger-ink)]"
                  }
                  key={item.page}
                  onClick={() => onNavigate(item.page)}
                  type="button"
                >
                  <LedgerIcon className="h-[18px] w-[18px] shrink-0" name={item.icon} />
                  <span>{item.label}</span>
                </button>
              );
            })}
          </nav>

          {onLock ? (
            <button
              className="mt-auto flex items-center gap-3 rounded-xl border border-transparent px-3 py-2.5 text-left text-sm font-medium text-[var(--ledger-muted)] hover:border-[var(--ledger-border)] hover:bg-white hover:text-[var(--ledger-ink)]"
              onClick={onLock}
              type="button"
            >
              <LedgerIcon className="h-[18px] w-[18px] shrink-0" name="lock" />
              <span>锁定账本</span>
            </button>
          ) : null}
        </aside>

        <section className="flex min-w-0 flex-1 flex-col">
          <header className="flex min-h-16 items-center justify-between gap-4 border-b border-[var(--ledger-border)] px-5 py-3 lg:px-7">
            <div>
              <p className="text-xs font-medium text-[var(--ledger-muted)]">
                加密账本工作区
              </p>
              <h1 className="mt-0.5 text-xl font-semibold tracking-tight">
                {PAGE_TITLES[currentPage]}
              </h1>
            </div>
            <FileStatusIndicator
              label={fileStatusLabel}
              tone={fileStatusTone}
            />
          </header>
          <div className="min-h-0 flex-1 overflow-y-auto px-5 py-5 lg:px-7">
            {children}
          </div>
        </section>
      </div>
    </main>
  );
}
