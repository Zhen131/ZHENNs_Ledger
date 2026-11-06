import type { ReactNode } from "react";

const PAGE_BUTTON_CLASS =
  "rounded-md border border-[var(--ledger-border)] bg-white px-3 py-2 font-medium text-slate-700 disabled:cursor-not-allowed disabled:opacity-50";

/**
 * The "N in total · page x of y · previous / next" strip under a paged list.
 * It translates nothing: the caller hands in the summary sentence, the two
 * button labels, and the region label already in the reader's language,
 * because each list words its summary differently.
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
