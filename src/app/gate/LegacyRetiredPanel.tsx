import type { Translate } from "@/ui";
import { AccessPanel } from "./AccessPanel";
import { FormError } from "./FormError";

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
