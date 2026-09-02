import { useLanguage } from "@/ui";

export function SessionFatalPanel({
  t,
}: Readonly<{
  t: ReturnType<typeof useLanguage>["t"];
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
