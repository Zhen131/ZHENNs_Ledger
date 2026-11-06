/**
 * 这个文件管「要换账本，但还有没存好的改动」时的提示。
 * 放弃改动并换过去的动作在 `app/persistence`。
 * 没有特别的决定。
 */
import type { Translate } from "@/ui";

/**
 * 这个组件画一条醒目的提示：有改动没存好，暂时换不了账本。
 * 用户点按钮，就放弃这些改动、换到新账本。
 */
export function RepositorySwitchBlockedNotice({
  discardDirtyChangesAndSwitchRepository,
  t,
}: Readonly<{
  discardDirtyChangesAndSwitchRepository: () => boolean;
  t: Translate;
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
