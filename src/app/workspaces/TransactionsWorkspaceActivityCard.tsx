"use client";

import { ActivityTable } from "@/features/activity/ui";
import { SurfaceCard } from "@/ui";
import type { LedgerActivityItem } from "@/features/activity";
import type { PendingDelete } from "./transactionsWorkspaceTypes";
import type {
  Dispatch,
  SetStateAction,
} from "react";
import type { useLanguage } from "@/ui";

export function TransactionsWorkspaceActivityCard({
  armDelete,
  armedItemId,
  clearPendingDelete,
  confirmDelete,
  currentPage,
  currentPageItems,
  expandedItemId,
  filteredItems,
  handleLocateComplete,
  isWritable,
  locateRequestForCurrentPage,
  pendingDelete,
  remainingMs,
  sequenceByItemKey,
  setArmedItemId,
  setCurrentPage,
  setExpandedItemId,
  setFeedback,
  t,
  todayKey,
  totalPages,
}: Readonly<{
  armDelete: (item: LedgerActivityItem) => void;
  armedItemId: string | null;
  clearPendingDelete: () => void;
  confirmDelete: (item: LedgerActivityItem) => void;
  currentPage: number;
  currentPageItems: readonly LedgerActivityItem[];
  expandedItemId: string | null;
  filteredItems: LedgerActivityItem[];
  handleLocateComplete: (requestId: number, result: "found" | "missing") => void;
  isWritable: boolean;
  locateRequestForCurrentPage: Readonly<{ date: string; requestId: number; }> | null;
  pendingDelete: PendingDelete | null;
  remainingMs: number;
  sequenceByItemKey: Map<string, number>;
  setArmedItemId: Dispatch<SetStateAction<string | null>>;
  setCurrentPage: Dispatch<SetStateAction<number>>;
  setExpandedItemId: Dispatch<SetStateAction<string | null>>;
  setFeedback: Dispatch<SetStateAction<string>>;
  t: ReturnType<typeof useLanguage>["t"];
  todayKey: string;
  totalPages: number;
}>) {
  return (
      <SurfaceCard className="min-w-0 p-0">
        <ActivityTable
          deleteDisabled={!isWritable}
          deleteState={{
            armedItemId,
            pendingItemId: pendingDelete?.itemId ?? null,
            pendingPhase: pendingDelete?.phase ?? null,
            remainingMs,
          }}
          expandedItemId={expandedItemId}
          items={currentPageItems}
          locateRequest={locateRequestForCurrentPage}
          onArmDelete={armDelete}
          onCancelDelete={() => setArmedItemId(null)}
          onConfirmDelete={confirmDelete}
          onExpandedItemIdChange={setExpandedItemId}
          onLocateComplete={handleLocateComplete}
          onUndoDelete={() => {
            clearPendingDelete();
            setFeedback(t("transactions.delete.undone"));
          }}
          sequenceByItemKey={sequenceByItemKey}
          todayKey={todayKey}
        />
        {filteredItems.length > 0 ? (
          <div
            aria-label={t("transactions.pagination.ariaLabel")}
            className="flex flex-wrap items-center justify-between gap-3 border-t border-[var(--ledger-border)] px-4 py-3 text-sm"
          >
            <p className="text-[var(--ledger-muted)]">
              {t("transactions.pagination.totalPrefix")} {filteredItems.length} {t("transactions.pagination.totalMiddle")} {currentPage} / {totalPages} {t("transactions.pagination.pageSuffix")}
            </p>
            <div className="flex items-center gap-2">
              <button
                className="rounded-md border border-[var(--ledger-border)] bg-white px-3 py-2 font-medium text-slate-700 disabled:cursor-not-allowed disabled:opacity-50"
                disabled={currentPage === 1}
                onClick={() => {
                  setExpandedItemId(null);
                  setCurrentPage((page) => page - 1);
                }}
                type="button"
              >
                {t("transactions.pagination.previous")}
              </button>
              <button
                className="rounded-md border border-[var(--ledger-border)] bg-white px-3 py-2 font-medium text-slate-700 disabled:cursor-not-allowed disabled:opacity-50"
                disabled={currentPage === totalPages}
                onClick={() => {
                  setExpandedItemId(null);
                  setCurrentPage((page) => page + 1);
                }}
                type="button"
              >
                {t("transactions.pagination.next")}
              </button>
            </div>
          </div>
        ) : null}
      </SurfaceCard>
  );
}
