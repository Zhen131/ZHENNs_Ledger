/**
 * 这个文件管存盘或读账本出错时页面上那条红色提示。
 * 出错的原因文字由 `app/persistence` 给。
 * 没有特别的决定。
 */
import type { Translate } from "@/ui";
import type { PersistenceOperation } from "@/app/persistence";

/**
 * 这个组件画一条醒目的出错提示，写出错在哪。
 * 能重试时多一个「重试保存」按钮；正在清空或导入时按钮点不了。
 */
export function PersistenceErrorNotice({
  canRetryPersistence,
  persistenceError,
  persistenceOperation,
  retryPersistence,
  t,
}: Readonly<{
  canRetryPersistence: boolean;
  persistenceError: string;
  persistenceOperation: PersistenceOperation;
  retryPersistence: () => Promise<boolean>;
  t: Translate;
}>) {
  return (
            <div
              aria-live="assertive"
              className="mb-5 flex flex-wrap items-center justify-between gap-3 rounded-md border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900"
            >
              <p>{persistenceError}</p>
              {canRetryPersistence ? (
                <button
                  className="rounded-md border border-amber-400 bg-white px-3 py-1.5 font-medium disabled:cursor-not-allowed disabled:opacity-50"
                  disabled={persistenceOperation !== "idle"}
                  onClick={() => void retryPersistence()}
                  type="button"
                >
                  {t("dashboard.action.retrySave")}
                </button>
              ) : null}
            </div>
  );
}
