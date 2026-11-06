/**
 * 这个文件管浏览器里还留着旧账本时的退役提示。
 * 要不要显示它，由 `ledgerAccessGateSession.ts` 判断。
 * 不显然的决定：提示页留着，再给新建、选已有两个出口。
 * 2026-11-06 定（W24 06 第二节第 1 条）。
 */
import type { Translate } from "@/ui";
import { AccessPanel } from "./AccessPanel";
import { FormError } from "./FormError";

/**
 * 这个组件画旧账本退役的提示：旧的浏览器账本已经不用了。
 * 用户可以选一个已有的账本文件，或新建一本。
 * 动作失败时下面显示红字。
 */
export function LegacyRetiredPanel({
  formError,
  isSubmitting,
  onCreate,
  onSelectExisting,
  t,
}: Readonly<{
  formError: string;
  isSubmitting: boolean;
  onCreate: () => void;
  onSelectExisting: () => void;
  t: Translate;
}>) {
  return (
      <AccessPanel
        description={t("access.legacy.description")}
        title={t("access.legacy.title")}
      >
        <p className="text-sm leading-6 text-[var(--ledger-muted)]">
          {t("access.legacy.hint")}
        </p>
        <div className="mt-4 grid gap-3">
          <button
            className="w-full rounded-xl bg-[var(--ledger-accent-strong)] px-4 py-3 text-sm font-semibold text-white hover:bg-[var(--ledger-accent)] disabled:opacity-60"
            disabled={isSubmitting}
            onClick={onSelectExisting}
            type="button"
          >
            {t("access.legacy.selectExisting")}
          </button>
          <button
            className="w-full rounded-xl border border-[var(--ledger-border-strong)] px-4 py-3 text-sm font-semibold text-[var(--ledger-ink)] hover:bg-[var(--ledger-surface-muted)] disabled:opacity-60"
            disabled={isSubmitting}
            onClick={onCreate}
            type="button"
          >
            {t("access.legacy.createLedger")}
          </button>
          <FormError message={formError} />
        </div>
      </AccessPanel>
  );
}
