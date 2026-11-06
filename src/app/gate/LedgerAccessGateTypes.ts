/**
 * 这个文件放进账本前那道检查用的几个类型。
 * 检查的流程在同目录 `LedgerAccessGate.tsx` 和 `ledgerAccessGate*.ts`。
 * 没有特别的决定。
 */
import { type LedgerSession } from "@/platform/persistence";

/**
 * 进账本前的大状态：正在查，等用户选，已打开。
 * 还有：正在上锁，上锁出错，出致命错后已关。
 * 正在上锁和上锁出错时，记着是不是因为致命错。
 */
export type AccessState =
  | { status: "checking" }
  | { status: "setup-required" }
  | { status: "unlocked"; session: LedgerSession }
  | { status: "locking"; fatal: boolean }
  | { status: "lock-error"; fatal: boolean }
  | { status: "fatal-closed" };

/** 等用户选时停在哪个面板：选择，退役提示，新建，重连，解锁，恢复。 */
export type AccessPath =
  | "choice"
  | "legacy-retired"
  | "file-create"
  | "file-reconnect-prompt"
  | "file-reconnect-error"
  | "file-open-unlock"
  | "file-recovery";

/** 一个没收完尾的会话：哪个会话，是否致命，怎么重试，收尾进度。 */
export type PendingSessionCompletion = {
  session: LedgerSession;
  fatal: boolean;
  retry: () => Promise<void>;
  completion: Promise<void>;
};
