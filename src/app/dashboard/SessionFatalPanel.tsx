/**
 * 这个文件管账本出了没法恢复的错时，整页换成的出错页面。
 * 什么时候换，由 `DashboardShell.tsx` 判断。
 * 没有特别的决定。
 */
import type { Translate } from "@/ui";

/**
 * 这个组件画整页的出错页面：一个标题，一段说明。
 * 用户在这里不能操作账本。
 */
export function SessionFatalPanel({
  t,
}: Readonly<{
  t: Translate;
}>) {
  return (
      <main className="flex min-h-screen items-center justify-center bg-slate-50 px-4 text-slate-950">
        <section className="w-full max-w-md rounded-2xl border border-red-200 bg-white p-6 shadow-sm">
          <h1 className="text-xl font-semibold text-slate-950">
            {t("dashboard.session.fatalTitle")}
          </h1>
          <p aria-live="assertive" className="mt-3 text-sm leading-6 text-slate-700">
            {t("dashboard.session.fatalDescription")}
          </p>
        </section>
      </main>
  );
}
