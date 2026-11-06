/**
 * 这个文件管读账本时发现兼容问题的提醒列表。
 * 哪些算提醒，由 `core/policies` 判断。
 * 没有特别的决定。
 */
import type { LedgerCompatibilityWarning } from "@/core/policies";
import type { Translate } from "@/ui";

/**
 * 这个组件画一块醒目的提醒，列出读账本时发现的兼容问题。
 * 每条写出在哪个位置、是什么问题，最多列前 8 条。
 * 用户只看，不能点。
 */
export function CompatibilityWarningList({
  compatibilityWarnings,
  t,
}: Readonly<{
  compatibilityWarnings: LedgerCompatibilityWarning[];
  t: Translate;
}>) {
  return (
            <div
              aria-live="assertive"
              className="mb-5 rounded-md border border-amber-300 bg-amber-50 px-4 py-3 text-sm text-amber-950"
            >
              <p className="font-semibold">{t("dashboard.compatibility.heading")}</p>
              <ul className="mt-2 grid gap-1">
                {compatibilityWarnings.slice(0, 8).map((warning, index) => (
                  <li key={`${warning.code}-${warning.path}-${index}`}>
                    <code>{warning.path}</code> · {warning.message}
                  </li>
                ))}
              </ul>
            </div>
  );
}
