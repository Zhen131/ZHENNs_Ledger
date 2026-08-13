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
    <main className="min-h-screen overflow-x-hidden bg-[var(--ledger-canvas)] p-2 text-[var(--ledger-ink)] sm:p-4">
      <div className="mx-auto flex min-h-[calc(100vh-1rem)] w-full max-w-[1500px] flex-col overflow-hidden rounded-[20px] border border-[var(--ledger-border)] bg-[var(--ledger-shell)] shadow-[var(--ledger-shadow)] sm:min-h-[calc(100vh-2rem)] sm:rounded-[24px] min-[1100px]:h-[calc(100vh-2rem)] min-[1100px]:min-h-0 min-[1100px]:flex-row">
        <aside className="flex w-full shrink-0 flex-col border-b border-[var(--ledger-border)] bg-[var(--ledger-surface-muted)] px-3 py-3 min-[1100px]:w-48 min-[1100px]:border-b-0 min-[1100px]:border-r min-[1100px]:py-5">
          <div className="flex items-center justify-between gap-3 px-2 min-[1100px]:block min-[1100px]:px-3">
            <p className="text-[11px] font-semibold uppercase tracking-[0.16em] text-[var(--ledger-accent-strong)]">
              Local-first
            </p>
            <p className="mt-1 text-lg font-semibold tracking-tight">
              Zhenn&apos;s Ledger
            </p>
          </div>

          <nav
            aria-label="账本主导航"
            className="mt-3 grid grid-cols-2 gap-1.5 sm:grid-cols-5 min-[1100px]:mt-8 min-[1100px]:grid-cols-1"
          >
            {NAV_ITEMS.map((item) => {
              const active = currentPage === item.page;
              return (
                <button
                  aria-current={active ? "page" : undefined}
                  className={
                    active
                      ? "flex min-w-0 items-center gap-2 rounded-xl bg-[var(--ledger-accent-soft)] px-2.5 py-2.5 text-left text-sm font-semibold text-[var(--ledger-accent-strong)] min-[1100px]:gap-3 min-[1100px]:px-3"
                      : "flex min-w-0 items-center gap-2 rounded-xl px-2.5 py-2.5 text-left text-sm font-medium text-[var(--ledger-muted)] hover:bg-white hover:text-[var(--ledger-ink)] min-[1100px]:gap-3 min-[1100px]:px-3"
                  }
                  key={item.page}
                  onClick={() => onNavigate(item.page)}
                  type="button"
                >
                  <LedgerIcon className="h-[18px] w-[18px] shrink-0" name={item.icon} />
                  <span className="min-w-0 leading-tight">{item.label}</span>
                </button>
              );
            })}
          </nav>

          {onLock ? (
            <button
              className="mt-2 flex items-center gap-3 self-start rounded-xl border border-transparent px-2.5 py-2 text-left text-sm font-medium text-[var(--ledger-muted)] hover:border-[var(--ledger-border)] hover:bg-white hover:text-[var(--ledger-ink)] min-[1100px]:mt-auto min-[1100px]:self-stretch min-[1100px]:px-3 min-[1100px]:py-2.5"
              onClick={onLock}
              type="button"
            >
              <LedgerIcon className="h-[18px] w-[18px] shrink-0" name="lock" />
              <span>锁定账本</span>
            </button>
          ) : null}
        </aside>

        <section className="flex min-w-0 flex-1 flex-col min-[1100px]:min-h-0">
          <header className="flex min-h-16 flex-wrap items-center justify-between gap-3 border-b border-[var(--ledger-border)] px-3 py-3 sm:px-5 min-[1100px]:px-7">
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
          <div className="min-w-0 flex-1 px-3 py-4 sm:px-5 sm:py-5 min-[1100px]:min-h-0 min-[1100px]:overflow-y-auto min-[1100px]:px-7">
            {children}
          </div>
        </section>
      </div>
    </main>
  );
}
