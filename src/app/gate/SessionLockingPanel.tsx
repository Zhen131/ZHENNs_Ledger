/**
 * 这个文件管「正在上锁」那一屏。
 * 上锁的过程在 `ledgerAccessGateSession.ts`。
 * 没有特别的决定。
 */
import type { Translate } from "@/ui";
import { AccessPanel } from "./AccessPanel";
import type { AccessState } from "./LedgerAccessGateTypes";

/**
 * 这个组件画正在上锁的画面，请用户等它收完尾。
 * 因为致命错上锁时，标题和说明换成出错的版本。
 */
export function SessionLockingPanel({
  accessState,
  t,
}: Readonly<{
  accessState: Extract<AccessState, { status: "locking" }>;
  t: Translate;
}>) {
  return (
      <AccessPanel
        description={
          accessState.fatal
            ? t("access.locking.fatalDescription")
            : t("access.locking.description")
        }
        title={accessState.fatal ? t("access.locking.fatalTitle") : t("access.locking.title")}
      >
        <p aria-live="polite" className="text-sm text-[var(--ledger-muted)]">
          {accessState.fatal
            ? t("access.locking.fatalHint")
            : t("access.locking.hint")}
        </p>
      </AccessPanel>
  );
}
