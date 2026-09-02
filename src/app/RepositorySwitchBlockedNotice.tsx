import { useLanguage } from "@/ui";

export function RepositorySwitchBlockedNotice({
  discardDirtyChangesAndSwitchRepository,
  t,
}: Readonly<{
  discardDirtyChangesAndSwitchRepository: () => boolean;
  t: ReturnType<typeof useLanguage>["t"];
}>) {
  return (
            <div
              aria-live="assertive"
              className="mb-5 flex flex-wrap items-center justify-between gap-3 rounded-md border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-900"
            >
              <p>
                {t("dashboard.repositorySwitchBlocked.description")}
              </p>
              <button
                className="rounded-md border border-red-300 bg-white px-3 py-1.5 font-medium"
                onClick={discardDirtyChangesAndSwitchRepository}
                type="button"
              >
                {t("dashboard.repositorySwitchBlocked.action")}
              </button>
            </div>
  );
}
