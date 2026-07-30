import type { LedgerFileHandle } from "../adapters/ledgerFileHandleAdapter";

const ADMISSION_LOCK_NAME =
  "local-first-trading-ledger:file-session:admission:v1";
const SESSION_LOCK_PREFIX =
  "local-first-trading-ledger:file-session:active:v1:";
const WRITE_LOCK_PREFIX =
  "local-first-trading-ledger:file-session:write:v1:";
const COORDINATION_CHANNEL_NAME =
  "local-first-trading-ledger:file-session:compare:v1";
const DEFAULT_RESPONSE_TIMEOUT_MS = 1_000;

export type AcquireLedgerFileSessionResult =
  | { status: "acquired"; lease: LedgerFileSessionLease }
  | { status: "in-use" }
  | { status: "unsupported" | "coordination-failed" };

export interface LedgerFileSessionLease {
  readonly sessionId: string;
  runExclusiveWrite<T>(operation: () => Promise<T>): Promise<T>;
  release(): Promise<void>;
}

export interface LedgerFileSessionCoordinator {
  acquire(
    handle: LedgerFileHandle,
  ): Promise<AcquireLedgerFileSessionResult>;
}

export type LedgerFileEntryComparison =
  | "same"
  | "different"
  | "failed";

export interface LedgerFileCoordinationRuntimeLease {
  runExclusiveWrite<T>(operation: () => Promise<T>): Promise<T>;
  release(): Promise<void>;
}

/**
 * Injectable browser boundary. The default implementation below is the only
 * production runtime; tests can use a deterministic implementation without
 * pretending that jsdom provides Web Locks or clonable file handles.
 */
export interface LedgerFileCoordinationRuntime {
  isSupported(): boolean;
  assertHandleCloneable(handle: LedgerFileHandle): void;
  createSessionId(): string;
  runAdmission<T>(operation: () => Promise<T>): Promise<T>;
  listActiveSessionIds(): Promise<string[]>;
  compareWithActiveSessions(
    sessionIds: readonly string[],
    candidate: LedgerFileHandle,
  ): Promise<LedgerFileEntryComparison>;
  holdSession(
    sessionId: string,
    handle: LedgerFileHandle,
  ): Promise<LedgerFileCoordinationRuntimeLease>;
}

export class DefaultLedgerFileSessionCoordinator
  implements LedgerFileSessionCoordinator
{
  constructor(
    private readonly runtime: LedgerFileCoordinationRuntime =
      new BrowserLedgerFileCoordinationRuntime(),
  ) {}

  async acquire(
    handle: LedgerFileHandle,
  ): Promise<AcquireLedgerFileSessionResult> {
    if (
      !this.runtime.isSupported() ||
      typeof handle.isSameEntry !== "function"
    ) {
      return { status: "unsupported" };
    }

    try {
      this.runtime.assertHandleCloneable(handle);
    } catch {
      return { status: "unsupported" };
    }

    try {
      return await this.runtime.runAdmission(async () => {
        const activeSessionIds =
          await this.runtime.listActiveSessionIds();
        if (activeSessionIds.length > 0) {
          const comparison =
            await this.runtime.compareWithActiveSessions(
              activeSessionIds,
              handle,
            );
          if (comparison === "same") {
            return { status: "in-use" } as const;
          }
          if (comparison === "failed") {
            return { status: "coordination-failed" } as const;
          }
        }

        const sessionId = this.runtime.createSessionId();
        if (activeSessionIds.includes(sessionId)) {
          return { status: "coordination-failed" } as const;
        }
        const runtimeLease = await this.runtime.holdSession(
          sessionId,
          handle,
        );
        return {
          status: "acquired",
          lease: new OwnedLedgerFileSessionLease(
            sessionId,
            runtimeLease,
          ),
        } as const;
      });
    } catch {
      return { status: "coordination-failed" };
    }
  }
}

class OwnedLedgerFileSessionLease implements LedgerFileSessionLease {
  private releasePromise: Promise<void> | null = null;
  private releaseRequested = false;
  private writeTail: Promise<void> = Promise.resolve();

  constructor(
    readonly sessionId: string,
    private readonly runtimeLease: LedgerFileCoordinationRuntimeLease,
  ) {}

  runExclusiveWrite<T>(operation: () => Promise<T>): Promise<T> {
    if (this.releaseRequested) {
      return Promise.reject(
        new Error("Ledger file session lease has been released"),
      );
    }

    const result = this.writeTail.then(() => {
      return this.runtimeLease.runExclusiveWrite(operation);
    });
    this.writeTail = result.then(
      () => undefined,
      () => undefined,
    );
    return result;
  }

  release(): Promise<void> {
    if (this.releasePromise) {
      return this.releasePromise;
    }

    this.releaseRequested = true;
    const releasePromise = this.writeTail.then(() =>
      this.runtimeLease.release(),
    );
    this.releasePromise = releasePromise;
    void releasePromise.catch(() => {
      if (this.releasePromise === releasePromise) {
        this.releasePromise = null;
      }
    });
    return releasePromise;
  }
}

type CoordinationProbeMessage = {
  kind: "ledger-file-entry-probe";
  requestId: string;
  targetSessionIds: string[];
  candidate: LedgerFileHandle;
};

type CoordinationProbeResultMessage = {
  kind: "ledger-file-entry-probe-result";
  requestId: string;
  sessionId: string;
  result: "same" | "different" | "error";
};

type LockSnapshot = {
  held?: Array<{ name?: string }>;
  pending?: Array<{ name?: string }>;
};

interface BrowserLockManager {
  request<T>(
    name: string,
    options: { mode: "exclusive"; signal?: AbortSignal },
    callback: () => Promise<T>,
  ): Promise<T>;
  query(): Promise<LockSnapshot>;
}

interface CoordinationChannel {
  postMessage(message: unknown): void;
  listen(listener: (message: unknown) => void): () => void;
  close(): void;
}

export type BrowserLedgerFileCoordinationEnvironment = {
  locks: BrowserLockManager;
  createChannel(): CoordinationChannel;
  cloneHandle(handle: LedgerFileHandle): void;
  createId(): string;
  createAbortController(): AbortController;
  setTimer(callback: () => void, delayMs: number): ReturnType<typeof setTimeout>;
  clearTimer(timer: ReturnType<typeof setTimeout>): void;
};

export class BrowserLedgerFileCoordinationRuntime
  implements LedgerFileCoordinationRuntime
{
  private readonly environment:
    | BrowserLedgerFileCoordinationEnvironment
    | null;

  constructor(
    environment: BrowserLedgerFileCoordinationEnvironment | null =
      createBrowserCoordinationEnvironment(),
    private readonly responseTimeoutMs = DEFAULT_RESPONSE_TIMEOUT_MS,
  ) {
    this.environment = environment;
  }

  isSupported(): boolean {
    return this.environment !== null;
  }

  assertHandleCloneable(handle: LedgerFileHandle): void {
    this.getEnvironment().cloneHandle(handle);
  }

  createSessionId(): string {
    return this.getEnvironment().createId();
  }

  runAdmission<T>(operation: () => Promise<T>): Promise<T> {
    return runBrowserAdmission(
      this.getEnvironment(),
      this.responseTimeoutMs,
      operation,
    );
  }

  async listActiveSessionIds(): Promise<string[]> {
    const snapshot = await this.getEnvironment().locks.query();
    const heldNames = snapshot.held?.map(({ name }) => name) ?? [];
    const pendingSession = snapshot.pending?.some(({ name }) =>
      name?.startsWith(SESSION_LOCK_PREFIX),
    );
    if (pendingSession) {
      throw new Error("A ledger file session lock is pending");
    }

    return heldNames.flatMap((name) =>
      name?.startsWith(SESSION_LOCK_PREFIX)
        ? [name.slice(SESSION_LOCK_PREFIX.length)]
        : [],
    );
  }

  compareWithActiveSessions(
    sessionIds: readonly string[],
    candidate: LedgerFileHandle,
  ): Promise<LedgerFileEntryComparison> {
    if (sessionIds.length === 0) {
      return Promise.resolve("different");
    }

    const environment = this.getEnvironment();
    const channel = environment.createChannel();
    const requestId = environment.createId();

    return new Promise<LedgerFileEntryComparison>((resolve) => {
      const unresolved = new Set(sessionIds);
      let settled = false;
      const settle = (result: LedgerFileEntryComparison) => {
        if (settled) return;
        settled = true;
        environment.clearTimer(timer);
        stopListening();
        channel.close();
        resolve(result);
      };
      const stopListening = channel.listen((message) => {
        if (
          !isProbeResultMessage(message) ||
          message.requestId !== requestId ||
          !unresolved.has(message.sessionId)
        ) {
          return;
        }
        unresolved.delete(message.sessionId);
        if (message.result === "same") {
          settle("same");
          return;
        }
        if (message.result === "error") {
          settle("failed");
          return;
        }
        if (unresolved.size === 0) {
          settle("different");
        }
      });
      const timer = environment.setTimer(
        () => settle("failed"),
        this.responseTimeoutMs,
      );

      try {
        channel.postMessage({
          kind: "ledger-file-entry-probe",
          requestId,
          targetSessionIds: [...sessionIds],
          candidate,
        } satisfies CoordinationProbeMessage);
      } catch {
        settle("failed");
      }
    });
  }

  async holdSession(
    sessionId: string,
    handle: LedgerFileHandle,
  ): Promise<LedgerFileCoordinationRuntimeLease> {
    return BrowserLedgerFileRuntimeLease.create(
      this.getEnvironment(),
      sessionId,
      handle,
    );
  }

  private getEnvironment(): BrowserLedgerFileCoordinationEnvironment {
    if (!this.environment) {
      throw new Error("Safe ledger file coordination is unavailable");
    }
    return this.environment;
  }
}

class BrowserLedgerFileRuntimeLease
  implements LedgerFileCoordinationRuntimeLease
{
  private releaseSignal!: () => void;
  private readonly heldLockPromise: Promise<void>;
  private readonly stopListening: () => void;
  private releasePromise: Promise<void> | null = null;
  private releaseRequested = false;

  private constructor(
    private readonly environment: BrowserLedgerFileCoordinationEnvironment,
    private readonly sessionId: string,
    private readonly channel: CoordinationChannel,
    handle: LedgerFileHandle,
    ready: { resolve(): void; reject(error: unknown): void },
  ) {
    this.stopListening = channel.listen((message) => {
      if (
        !isProbeMessage(message) ||
        !message.targetSessionIds.includes(this.sessionId)
      ) {
        return;
      }

      void handle.isSameEntry(message.candidate).then(
        (same) => {
          this.postProbeResult(message.requestId, same ? "same" : "different");
        },
        () => {
          this.postProbeResult(message.requestId, "error");
        },
      );
    });

    const releaseSignal = new Promise<void>((resolve) => {
      this.releaseSignal = resolve;
    });
    this.heldLockPromise = environment.locks.request(
      `${SESSION_LOCK_PREFIX}${sessionId}`,
      { mode: "exclusive" },
      async () => {
        ready.resolve();
        await releaseSignal;
      },
    );
    void this.heldLockPromise.catch((error) => {
      ready.reject(error);
    });
  }

  static async create(
    environment: BrowserLedgerFileCoordinationEnvironment,
    sessionId: string,
    handle: LedgerFileHandle,
  ): Promise<BrowserLedgerFileRuntimeLease> {
    const channel = environment.createChannel();
    let resolveReady!: () => void;
    let rejectReady!: (error: unknown) => void;
    const ready = new Promise<void>((resolve, reject) => {
      resolveReady = resolve;
      rejectReady = reject;
    });
    const lease = new BrowserLedgerFileRuntimeLease(
      environment,
      sessionId,
      channel,
      handle,
      {
        resolve: resolveReady,
        reject: rejectReady,
      },
    );
    try {
      await ready;
      return lease;
    } catch (error) {
      channel.close();
      throw error;
    }
  }

  runExclusiveWrite<T>(operation: () => Promise<T>): Promise<T> {
    if (this.releaseRequested) {
      return Promise.reject(
        new Error("Ledger file runtime lease has been released"),
      );
    }
    return this.environment.locks.request(
      `${WRITE_LOCK_PREFIX}${this.sessionId}`,
      { mode: "exclusive" },
      operation,
    );
  }

  release(): Promise<void> {
    if (this.releasePromise) {
      return this.releasePromise;
    }
    this.releaseRequested = true;
    let cleanupPromise: Promise<void> | null = null;
    const cleanup = () => {
      cleanupPromise ??= this.finishRelease();
      return cleanupPromise;
    };
    this.releasePromise = this.environment.locks
      .request(
        ADMISSION_LOCK_NAME,
        { mode: "exclusive" },
        cleanup,
      )
      .catch(cleanup);
    return this.releasePromise;
  }

  private async finishRelease(): Promise<void> {
    try {
      this.stopListening();
    } catch {
      // Releasing the runtime lock remains authoritative.
    }
    try {
      this.channel.close();
    } catch {
      // Releasing the runtime lock remains authoritative.
    }
    this.releaseSignal();
    try {
      await this.heldLockPromise;
    } catch {
      // A rejected holder promise also means the browser no longer holds it.
    }
  }

  private postProbeResult(
    requestId: string,
    result: CoordinationProbeResultMessage["result"],
  ): void {
    try {
      this.channel.postMessage({
        kind: "ledger-file-entry-probe-result",
        requestId,
        sessionId: this.sessionId,
        result,
      } satisfies CoordinationProbeResultMessage);
    } catch {
      // The requester treats a missing response as coordination-failed.
    }
  }
}

function isProbeMessage(
  input: unknown,
): input is CoordinationProbeMessage {
  if (typeof input !== "object" || input === null) return false;
  const candidate = input as Partial<CoordinationProbeMessage>;
  return (
    candidate.kind === "ledger-file-entry-probe" &&
    typeof candidate.requestId === "string" &&
    Array.isArray(candidate.targetSessionIds) &&
    candidate.targetSessionIds.every(
      (sessionId) => typeof sessionId === "string",
    ) &&
    typeof candidate.candidate === "object" &&
    candidate.candidate !== null
  );
}

function isProbeResultMessage(
  input: unknown,
): input is CoordinationProbeResultMessage {
  if (typeof input !== "object" || input === null) return false;
  const candidate = input as Partial<CoordinationProbeResultMessage>;
  return (
    candidate.kind === "ledger-file-entry-probe-result" &&
    typeof candidate.requestId === "string" &&
    typeof candidate.sessionId === "string" &&
    (candidate.result === "same" ||
      candidate.result === "different" ||
      candidate.result === "error")
  );
}

function createBrowserCoordinationEnvironment():
  | BrowserLedgerFileCoordinationEnvironment
  | null {
  const candidateGlobal = globalThis as typeof globalThis & {
    BroadcastChannel?: typeof BroadcastChannel;
    structuredClone?: typeof structuredClone;
  };
  const lockManager = globalThis.navigator?.locks as
    | BrowserLockManager
    | undefined;
  if (
    !lockManager ||
    typeof lockManager.request !== "function" ||
    typeof lockManager.query !== "function" ||
    typeof candidateGlobal.BroadcastChannel !== "function" ||
    typeof candidateGlobal.structuredClone !== "function" ||
    typeof globalThis.crypto?.randomUUID !== "function"
  ) {
    return null;
  }

  return {
    locks: lockManager,
    createChannel: () => {
      const channel = new candidateGlobal.BroadcastChannel!(
        COORDINATION_CHANNEL_NAME,
      );
      return {
        postMessage: (message) => channel.postMessage(message),
        listen: (listener) => {
          const onMessage = (event: MessageEvent<unknown>) =>
            listener(event.data);
          channel.addEventListener("message", onMessage);
          return () => channel.removeEventListener("message", onMessage);
        },
        close: () => channel.close(),
      };
    },
    cloneHandle: (handle) => {
      candidateGlobal.structuredClone!(handle);
    },
    createId: () => globalThis.crypto.randomUUID(),
    createAbortController: () => new AbortController(),
    setTimer: (callback, delayMs) => setTimeout(callback, delayMs),
    clearTimer: (timer) => clearTimeout(timer),
  };
}

async function runBrowserAdmission<T>(
  environment: BrowserLedgerFileCoordinationEnvironment,
  timeoutMs: number,
  operation: () => Promise<T>,
): Promise<T> {
  const abortController = environment.createAbortController();
  const timer = environment.setTimer(
    () => abortController.abort(),
    timeoutMs,
  );
  try {
    return await environment.locks.request(
      ADMISSION_LOCK_NAME,
      { mode: "exclusive", signal: abortController.signal },
      operation,
    );
  } finally {
    environment.clearTimer(timer);
  }
}
