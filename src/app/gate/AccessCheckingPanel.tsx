/**
 * 这个文件管进账本前「正在检查」那一屏。
 * 检查本身在 `ledgerAccessGateSession.ts`。
 * 没有特别的决定。
 */
import type { Translate } from "@/ui";
import { AccessPanel } from "./AccessPanel";

/**
 * 这个组件画「正在检查」的画面，只请用户稍等，没有按钮。
 */
export function AccessCheckingPanel({
  t,
}: Readonly<{
  t: Translate;
}>) {
  return (
      <AccessPanel
        description={t("access.checking.description")}
        title={t("access.checking.title")}
      >
        <p aria-live="polite" className="text-sm text-[var(--ledger-muted)]">
          {t("access.action.wait")}
        </p>
      </AccessPanel>
  );
}
