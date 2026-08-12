import { SurfaceCard } from "@/ui";

export function SettingsWorkspace({
  active,
}: Readonly<{ active: boolean }>) {
  return (
    <section
      aria-label="设置工作区"
      className={active ? "grid min-w-0 gap-5" : "hidden"}
      data-workspace-page="settings"
    >
      <SurfaceCard className="p-6">
        <h2 className="text-lg font-semibold">账本设置</h2>
        <p className="mt-2 text-sm leading-6 text-[var(--ledger-muted)]">
          行情映射、手续费规则与危险操作会继续使用现有认证保存和文件安全合同。
        </p>
      </SurfaceCard>
    </section>
  );
}
