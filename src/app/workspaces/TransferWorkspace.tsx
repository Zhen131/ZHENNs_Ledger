/**
 * 这个文件管「导入与导出」页：导出和导入备份的那一页。
 * 备份面板本身在 `features/backup`，由外层传进来。
 * 页面不在前台时不画备份面板。
 * 没有特别的决定。
 */
import type { ReactNode } from "react";

import { SurfaceCard, useLanguage } from "@/ui";

/**
 * 这个组件画「导入与导出」页。
 * 页上有标题，隐私提醒，导出导入说明，备份面板。
 * 用户在备份面板里导出 B 文件，或从 B 文件导入。
 * 不在前台时整页隐藏，备份面板也不画。
 */
export function TransferWorkspace({
  active,
  backupPanel,
}: Readonly<{
  active: boolean;
  backupPanel: ReactNode;
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
