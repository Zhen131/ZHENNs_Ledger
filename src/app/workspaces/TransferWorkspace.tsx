import type { ReactNode } from "react";

import type { LedgerStorageKind } from "@/platform/persistence";
import { SurfaceCard, useLanguage } from "@/ui";

export function TransferWorkspace({
  active,
  backupPanel,
}: Readonly<{
  active: boolean;
  backupPanel: ReactNode;
  /**
   * Accepted for existing callers; the ledger file is the only storage kind,
   * so nothing here branches on it any more.
   */
  storageKind?: LedgerStorageKind;
}>) {
  const { t } = useLanguage();

  return (
    <section
      aria-label={t("transfer.workspace.ariaLabel")}
      className={active ? "grid min-w-0 gap-4" : "hidden"}
      data-workspace-page="transfer"
    >
      <SurfaceCard className="p-5">
        <h2 className="text-lg font-semibold">{t("transfer.heading")}</h2>
        <p className="mt-1 text-sm leading-6 text-[var(--ledger-muted)]">
          {t("transfer.description.file")}
        </p>
      </SurfaceCard>

      <p className="rounded-xl border border-amber-300 bg-amber-50 px-4 py-3 text-sm leading-6 text-amber-950">
        {t("transfer.privacyWarning")}
      </p>

      <div className="grid min-w-0 gap-4 min-[1100px]:grid-cols-[minmax(220px,.7fr)_minmax(0,1.3fr)]">
        <SurfaceCard className="p-5">
          <h3 className="font-semibold">{t("transfer.export.heading")}</h3>
          <p className="mt-2 text-sm leading-6 text-[var(--ledger-muted)]">
            {t("transfer.export.description")}
          </p>
        </SurfaceCard>
        <SurfaceCard className="p-5">
          <h3 className="font-semibold">{t("transfer.import.heading")}</h3>
          <p className="mt-2 text-sm leading-6 text-[var(--ledger-muted)]">
            {t("transfer.import.description")}
          </p>
        </SurfaceCard>
      </div>

      <SurfaceCard className="min-w-0 p-5">
        {active ? backupPanel : null}
      </SurfaceCard>
    </section>
  );
}
