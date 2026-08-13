import type { ReactNode } from "react";

import { SurfaceCard } from "@/ui";

export function TransferWorkspace({
  active,
  backupPanel,
  storageKind,
}: Readonly<{
  active: boolean;
  backupPanel: ReactNode;
  storageKind: "indexeddb" | "ledger-file";
}>) {
  return (
    <section
      aria-label="导入与导出工作区"
      className={active ? "grid min-w-0 gap-4" : "hidden"}
      data-workspace-page="transfer"
    >
      <SurfaceCard className="p-5">
        <h2 className="text-lg font-semibold">导入与导出</h2>
        <p className="mt-1 text-sm leading-6 text-[var(--ledger-muted)]">
          {storageKind === "ledger-file"
            ? "当前 .lftl 是加密正式账本；这里导入或导出的备份文件始终是另一份明文 JSON。"
            : "这里导入或导出的备份文件是明文 JSON，不等同于浏览器中的本地账本记录。"}
        </p>
      </SurfaceCard>

      <p className="rounded-xl border border-amber-300 bg-amber-50 px-4 py-3 text-sm leading-6 text-amber-950">
        ⚠ 明文备份包含完整资产、交易、价格和手续费规则。请核对浏览器实际下载位置；同步目录可能自动上传文件，不再需要时请安全删除。
      </p>

      <div className="grid min-w-0 gap-4 min-[1100px]:grid-cols-[minmax(220px,.7fr)_minmax(0,1.3fr)]">
        <SurfaceCard className="p-5">
          <h3 className="font-semibold">导出明文账本</h3>
          <p className="mt-2 text-sm leading-6 text-[var(--ledger-muted)]">
            导出不会修改当前账本；下载是否落盘仍以浏览器下载列表为准。
          </p>
        </SurfaceCard>
        <SurfaceCard className="p-5">
          <h3 className="font-semibold">预检并完整替换</h3>
          <p className="mt-2 text-sm leading-6 text-[var(--ledger-muted)]">
            先只读预检；只有通过当前文件授权、预检凭据和复读验证后才会写入，不会合并账本。
          </p>
        </SurfaceCard>
      </div>

      <SurfaceCard className="min-w-0 p-5">
        {active ? backupPanel : null}
      </SurfaceCard>
    </section>
  );
}
