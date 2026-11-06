/**
 * 这个文件管「转移」页：导出和导入备份的那一页。
 * 备份面板本身在 `features/backup`，由外层传进来。
 * 不显然的决定：页面不在前台时不画备份面板。
 */
import type { ReactNode } from "react";

import type { LedgerStorageKind } from "@/platform/persistence";
import { SurfaceCard, useLanguage } from "@/ui";

/**
 * 这个组件画转移页：标题，隐私提醒，导出导入说明，备份面板。
 * 用户在备份面板里导出 B 文件，或从 B 文件导入。
 * 不在前台时整页隐藏，备份面板也不画。
 */
export function TransferWorkspace({
  active,
  backupPanel,
}: Readonly<{
  active: boolean;
  backupPanel: ReactNode;
  /**
   * 这个参数不起作用：账本文件已是唯一的存法，不再按它分支。
   * 正式代码没有传它，只有几份测试还传；备忘录 B0-32 等拆。
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
