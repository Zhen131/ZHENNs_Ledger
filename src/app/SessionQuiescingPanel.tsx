import { useLanguage } from "@/ui";

export function SessionQuiescingPanel({
  t,
}: Readonly<{
  t: ReturnType<typeof useLanguage>["t"];
}>) {
  return (
      <main className="flex min-h-screen items-center justify-center bg-slate-50 px-4 text-slate-950">
        <p aria-live="polite" className="text-sm text-slate-700">
          {t("dashboard.session.quiescing")}
        </p>
      </main>
  );
}
