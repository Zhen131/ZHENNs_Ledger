import type { Translate } from "@/ui";
import { AccessPanel } from "./AccessPanel";

export function AccessCheckingPanel({
  t,
}: Readonly<{
  t: Translate;
}>) {
  return (
      <AccessPanel
        description={t("access.checking.description")}
        title={t("access.checking.title")}
      >
        <p aria-live="polite" className="text-sm text-[var(--ledger-muted)]">
          {t("access.action.wait")}
        </p>
      </AccessPanel>
  );
}
