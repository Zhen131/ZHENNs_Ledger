/**
 * 这个文件管一次打开账本期间。
 * 程序内部记着的那份状态长什么样。
 * 它不管状态怎么变，那在 ledgerRepository.ts。
 * 没有特别的决定。
 */

import type {
  LedgerRepository,
  SessionQuiesceRequest,
  LedgerReadyClearDriver,
  LedgerReadyImportDriver,
  LedgerSessionPersistencePort,
} from "./ledgerRepositoryContract";

type SessionPhase =
  | "active"
  | "quiescing"
  | "drained"
  | "revoked"
  | "released";

/**
 * 一次打开账本期间内部记着的状态。
 * 记的有第几次、在哪个阶段、存取账本的那一方。
 * 还有清空和导入的执行方。
 * 只在 persistence 区里面用，不交给界面。
 */
export type SessionRuntime = {
  readonly sessionId: string;
  generation: number;
  phase: SessionPhase;
  repository: LedgerRepository | null;
  readonly release: () => Promise<void>;
  readonly onBeginQuiesce: () => void;
  request: SessionQuiesceRequest | null;
  completionKind: "lock" | "release" | null;
  completionPromise: Promise<void> | null;
  persistencePortOwner: object | null;
  persistencePort: LedgerSessionPersistencePort | null;
  readonly readyClearDriver: LedgerReadyClearDriver | null;
  readonly readyImportDriver: LedgerReadyImportDriver | null;
  readonly activeImportControllers: Set<AbortController>;
};
