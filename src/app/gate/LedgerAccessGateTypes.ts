import { type LedgerAccessErrorCode } from "@/platform/legacy";
import { type LedgerSession } from "@/platform/persistence";

export type AccessState =
  | { status: "checking" }
  | { status: "setup-required" }
  | { status: "unlock-required"; notice?: string }
  | { status: "unlocked"; session: LedgerSession }
  | { status: "locking"; fatal: boolean }
  | { status: "lock-error"; fatal: boolean }
  | { status: "fatal-closed" }
  | { status: "error"; code: LedgerAccessErrorCode };

export type AccessPath =
  | "choice"
  | "legacy-retired"
  | "file-create"
  | "file-reconnect-prompt"
  | "file-reconnect-error"
  | "file-open-unlock"
  | "file-recovery";

export type PendingSessionCompletion = {
  session: LedgerSession;
  fatal: boolean;
  retry: () => Promise<void>;
  completion: Promise<void>;
};
