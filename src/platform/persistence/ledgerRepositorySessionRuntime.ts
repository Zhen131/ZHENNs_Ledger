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
