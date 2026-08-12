import { SurfaceCard } from "@/ui";

export function TransferWorkspace({
  active,
}: Readonly<{ active: boolean }>) {
  return (
    <section
      aria-label="导入与导出工作区"
      className={active ? "grid min-w-0 gap-5" : "hidden"}
      data-workspace-page="transfer"
    >
      <SurfaceCard className="p-6">
        <h2 className="text-lg font-semibold">导入与导出</h2>
        <p className="mt-2 text-sm leading-6 text-[var(--ledger-muted)]">
          明文备份与整本替换仍复用既有预检、receipt、补偿与复读验证状态机。
        </p>
      </SurfaceCard>
    </section>
  );
}
