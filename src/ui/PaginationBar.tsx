/**
 * 这个文件管分页列表下面那一条翻页条。
 * 它不翻译任何文字，那些句子由调用方按当前语言给好。
 * 不显然的决定：总数那句交给调用方，因为各列表说法不同。
 * 2026-11-06 提交 2cb6e33 写下这个理由。
 */
import type { ReactNode } from "react";

const PAGE_BUTTON_CLASS =
  "rounded-md border border-[var(--ledger-border)] bg-white px-3 py-2 font-medium text-slate-700 disabled:cursor-not-allowed disabled:opacity-50";

/**
 * 这个组件画列表下面的翻页条。
 * 左边是总数那句话，右边是上一页和下一页两个按钮。
 * 在第一页时上一页点不了，在最后一页时下一页点不了。
 */
export function PaginationBar({
  ariaLabel,
  className,
  summary,
  previousLabel,
  nextLabel,
  currentPage,
  totalPages,
  onPrevious,
  onNext,
}: Readonly<{
  ariaLabel: string;
  className: string;
  summary: ReactNode;
  previousLabel: string;
  nextLabel: string;
  currentPage: number;
  totalPages: number;
  onPrevious: () => void;
  onNext: () => void;
}>) {
  return (
    <div aria-label={ariaLabel} className={className}>
      <p className="text-[var(--ledger-muted)]">{summary}</p>
      <div className="flex items-center gap-2">
        <button
          className={PAGE_BUTTON_CLASS}
          disabled={currentPage === 1}
          onClick={onPrevious}
          type="button"
        >
          {previousLabel}
        </button>
        <button
          className={PAGE_BUTTON_CLASS}
          disabled={currentPage === totalPages}
          onClick={onNext}
          type="button"
        >
          {nextLabel}
        </button>
      </div>
    </div>
  );
}
