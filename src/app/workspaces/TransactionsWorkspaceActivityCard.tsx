/**
 * 这个文件管交易页下面那张流水列表卡片。
 * 筛选和删除的逻辑在 `TransactionsWorkspace.tsx` 和 `transactionsWorkspaceDeletion.ts`。
 * 没有特别的决定。
 */
"use client";

import { ActivityTable } from "@/features/activity/ui";
import { PaginationBar, SurfaceCard } from "@/ui";
import type { LedgerActivityItem } from "@/features/activity";
import type { PendingDelete } from "./transactionsWorkspaceTypes";
import type {
  Dispatch,
  SetStateAction,
} from "react";
import type { Translate } from "@/ui";

/**
 * 这个组件画当前这一页的流水，和下面的翻页条。
 * 每一条能展开看细节，能点两下删除。
 * 倒数中的那一条显示剩几秒和撤回按钮。
 */
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
  t: Translate;
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
          <PaginationBar
            ariaLabel={t("transactions.pagination.ariaLabel")}
            className="flex flex-wrap items-center justify-between gap-3 border-t border-[var(--ledger-border)] px-4 py-3 text-sm"
            currentPage={currentPage}
            nextLabel={t("transactions.pagination.next")}
            onNext={() => {
              setExpandedItemId(null);
              setCurrentPage((page) => page + 1);
            }}
            onPrevious={() => {
              setExpandedItemId(null);
              setCurrentPage((page) => page - 1);
            }}
            previousLabel={t("transactions.pagination.previous")}
            summary={
              <>
                {t("transactions.pagination.totalPrefix")} {filteredItems.length} {t("transactions.pagination.totalMiddle")} {currentPage} / {totalPages} {t("transactions.pagination.pageSuffix")}
              </>
            }
            totalPages={totalPages}
          />
        ) : null}
      </SurfaceCard>
  );
}
