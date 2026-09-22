import { useLanguage } from "@/ui";
import { AccessPanel } from "./AccessPanel";
import type { AccessState } from "./LedgerAccessGateTypes";

export function SessionLockingPanel({
  accessState,
  t,
}: Readonly<{
  accessState: Extract<AccessState, { status: "locking" }>;
  t: ReturnType<typeof useLanguage>["t"];
}>) {
  return (
      <AccessPanel
        description={
          accessState.fatal
            ? t("access.locking.fatalDescription")
            : t("access.locking.description")
        }
        title={accessState.fatal ? t("access.locking.fatalTitle") : t("access.locking.title")}
      >
        <p aria-live="polite" className="text-sm text-[var(--ledger-muted)]">
          {accessState.fatal
            ? t("access.locking.fatalHint")
            : t("access.locking.hint")}
        </p>
      </AccessPanel>
  );
}
