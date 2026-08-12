import { SurfaceCard } from "@/ui";

export function TransactionsWorkspace({
  active,
}: Readonly<{ active: boolean }>) {
  return (
    <section
      aria-label="交易工作区"
      className={active ? "grid min-w-0 gap-5" : "hidden"}
      data-workspace-page="transactions"
    >
      <SurfaceCard className="p-6">
        <h2 className="text-lg font-semibold">交易记录</h2>
        <p className="mt-2 text-sm leading-6 text-[var(--ledger-muted)]">
          这里将承载现有交易事实的筛选、详情与安全删除，不提供编辑事实的假入口。
        </p>
      </SurfaceCard>
    </section>
  );
}
