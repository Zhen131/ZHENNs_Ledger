/**
 * 这个文件管上锁前的确认框。
 * 什么时候弹出，由 `dashboardShellActions.ts` 判断。
 * 没有特别的决定。
 */
import type { Dispatch, SetStateAction } from "react";

import type { Translate } from "@/ui";
import type { PersistenceOperation } from "@/app/persistence";

/**
 * 这个组件画上锁前的确认框。
 * 它说明还有没存好的改动，或表单里还有草稿。
 * 用户可以：重试存盘，放弃并上锁，或取消。
 */
export function LockConfirmationPanel({
  canRetryPersistence,
  confirmDiscardAndLock,
  lockConfirmationHasDrafts,
  persistenceOperation,
  retrySaveBeforeLock,
  setShowLockConfirmation,
  t,
}: Readonly<{
  canRetryPersistence: boolean;
  confirmDiscardAndLock: () => void;
  lockConfirmationHasDrafts: boolean;
  persistenceOperation: PersistenceOperation;
  retrySaveBeforeLock: () => Promise<void>;
  setShowLockConfirmation: Dispatch<SetStateAction<boolean>>;
  t: Translate;
}>) {
  return (
            <section
              aria-label={t("dashboard.lockConfirmation.ariaLabel")}
              className="mb-5 rounded-md border border-red-200 bg-red-50 px-4 py-4 text-sm text-red-900"
            >
              <p className="font-medium">{t("dashboard.lockConfirmation.heading")}</p>
              <p className="mt-1 leading-6">
                {lockConfirmationHasDrafts
                  ? t("dashboard.lockConfirmation.withDrafts")
                  : t("dashboard.lockConfirmation.withoutDrafts")}
              </p>
              <div className="mt-3 flex flex-wrap gap-3">
                <button
                  className="rounded-md border border-red-300 bg-white px-3 py-2 font-medium disabled:opacity-50"
                  disabled={
                    !canRetryPersistence ||
                    persistenceOperation !== "idle"
                  }
                  onClick={() => void retrySaveBeforeLock()}
                  type="button"
                >
                  {t("dashboard.lockConfirmation.retrySave")}
                </button>
                <button
                  className="rounded-md bg-red-700 px-3 py-2 font-medium text-white"
                  onClick={confirmDiscardAndLock}
                  type="button"
                >
                  {t("dashboard.lockConfirmation.discardAndLock")}
                </button>
                <button
                  className="rounded-md border border-slate-300 bg-white px-3 py-2 font-medium text-slate-700"
                  onClick={() => setShowLockConfirmation(false)}
                  type="button"
                >
                  {t("dashboard.action.cancel")}
                </button>
              </div>
            </section>
  );
}
