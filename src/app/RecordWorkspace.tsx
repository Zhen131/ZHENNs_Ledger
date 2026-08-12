import { SurfaceCard } from "@/ui";

export function RecordWorkspace({ active }: Readonly<{ active: boolean }>) {
  return (
    <section
      aria-label="记账工作区"
      className={active ? "grid min-w-0 gap-5" : "hidden"}
      data-workspace-page="record"
    >
      <SurfaceCard className="p-6">
        <h2 className="text-lg font-semibold">新增交易与更新价格</h2>
        <p className="mt-2 text-sm leading-6 text-[var(--ledger-muted)]">
          交易改变持仓与成本；价格只改变估值与图表。现有录入能力将在本工作区组合，不建立第二份账本状态。
        </p>
      </SurfaceCard>
    </section>
  );
}
