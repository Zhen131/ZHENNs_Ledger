/**
 * 这个文件管账本正在停工时整页显示的那句话。
 * 什么时候显示，由 `DashboardShell.tsx` 判断。
 * 没有特别的决定。
 */
import type { Translate } from "@/ui";

/**
 * 这个组件画一整页，只写一句「正在安全锁定」开头的话。
 * 这时账本停止接新活，等手上的活做完。
 */
export function SessionQuiescingPanel({
  t,
}: Readonly<{
  t: Translate;
}>) {
  return (
      <main className="flex min-h-screen items-center justify-center bg-slate-50 px-4 text-slate-950">
        <p aria-live="polite" className="text-sm text-slate-700">
          {t("dashboard.session.quiescing")}
        </p>
      </main>
  );
}
