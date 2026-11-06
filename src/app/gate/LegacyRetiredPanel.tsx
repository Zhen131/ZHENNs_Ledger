import type { Translate } from "@/ui";
import { AccessPanel } from "./AccessPanel";

export function LegacyRetiredPanel({
  t,
}: Readonly<{
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
      </AccessPanel>
  );
}
