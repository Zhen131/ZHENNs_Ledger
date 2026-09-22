import { useLanguage } from "@/ui";
import type { PersistenceOperation } from "@/app/persistence";

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
  t: ReturnType<typeof useLanguage>["t"];
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
