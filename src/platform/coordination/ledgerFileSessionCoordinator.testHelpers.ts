import type { LedgerFileHandle, LedgerFileWritable } from "@/platform/files";
import {
  BrowserLedgerFileCoordinationRuntime,
  type BrowserLedgerFileCoordinationEnvironment,
  type LedgerFileCoordinationRuntime,
  type LedgerFileCoordinationRuntimeLease,
  type LedgerFileEntryComparison,
} from "./ledgerFileSessionCoordinator";

export class IdentityFileHandle implements LedgerFileHandle {
  readonly name = "ledger.lftl";

  constructor(
    readonly entryId: string,
    readonly copiedFileId = "same-file-id",
    private readonly comparisonFails = false,
  ) {}

  async getFile() {
    return {
      size: 0,
      arrayBuffer: async () => new ArrayBuffer(0),
    };
  }

  async createWritable(): Promise<LedgerFileWritable> {
    return {
      write: async () => undefined,
      close: async () => undefined,
    };
  }

  async isSameEntry(other: LedgerFileHandle): Promise<boolean> {
    if (this.comparisonFails) {
      throw new Error("comparison failed");
    }
    return (
      other instanceof IdentityFileHandle &&
      other.entryId === this.entryId
    );
  }
}

export type ActiveRuntimeLease = {
  handle: LedgerFileHandle;
  lease: FakeRuntimeLease;
};

export class FakeCoordinationRuntime implements LedgerFileCoordinationRuntime {
  supported = true;
  cloneFails = false;
  listFails = false;
  holdFails = false;
  compareOverride: LedgerFileEntryComparison | null = null;
  readonly active = new Map<string, ActiveRuntimeLease>();
  readonly events: string[] = [];
  private admissionTail: Promise<void> = Promise.resolve();
  private nextId = 0;

  isSupported(): boolean {
    return this.supported;
  }

  assertHandleCloneable(): void {
    if (this.cloneFails) {
      throw new DOMException("cannot clone", "DataCloneError");
    }
  }

  createSessionId(): string {
    this.nextId += 1;
    return `session-${this.nextId}`;
  }

  runAdmission<T>(operation: () => Promise<T>): Promise<T> {
    const result = this.admissionTail.then(operation);
    this.admissionTail = result.then(
      () => undefined,
      () => undefined,
    );
    return result;
  }

  async listActiveSessionIds(): Promise<string[]> {
    if (this.listFails) {
      throw new Error("query failed");
    }
    return [...this.active.keys()];
  }

  async compareWithActiveSessions(
    sessionIds: readonly string[],
    candidate: LedgerFileHandle,
  ): Promise<LedgerFileEntryComparison> {
    if (this.compareOverride) {
      return this.compareOverride;
    }
    for (const sessionId of sessionIds) {
      const active = this.active.get(sessionId);
      if (!active) {
        return "failed";
      }
      try {
        if (await active.handle.isSameEntry(candidate)) {
          return "same";
        }
      } catch {
        return "failed";
      }
    }
    return "different";
  }

  async holdSession(
    sessionId: string,
    handle: LedgerFileHandle,
  ): Promise<LedgerFileCoordinationRuntimeLease> {
    if (this.holdFails) {
      throw new Error("could not hold session");
    }
    const lease = new FakeRuntimeLease(
      sessionId,
      this.active,
      this.events,
    );
    this.active.set(sessionId, { handle, lease });
    return lease;
  }
}

export class FakeRuntimeLease implements LedgerFileCoordinationRuntimeLease {
  private writeTail: Promise<void> = Promise.resolve();
  private released = false;
  failNextRelease = false;

  constructor(
    private readonly sessionId: string,
    private readonly active: Map<string, ActiveRuntimeLease>,
    private readonly events: string[],
  ) {}

  runExclusiveWrite<T>(operation: () => Promise<T>): Promise<T> {
    if (this.released) {
      return Promise.reject(new Error("released"));
    }
    const result = this.writeTail.then(async () => {
      this.events.push(`write-start:${this.sessionId}`);
      try {
        return await operation();
      } finally {
        this.events.push(`write-end:${this.sessionId}`);
      }
    });
    this.writeTail = result.then(
      () => undefined,
      () => undefined,
    );
    return result;
  }

  async release(): Promise<void> {
    if (this.released) return;
    if (this.failNextRelease) {
      this.failNextRelease = false;
      throw new Error("runtime release failed");
    }
    this.released = true;
    await this.writeTail;
    const active = this.active.get(this.sessionId);
    if (active?.lease === this) {
      this.active.delete(this.sessionId);
    }
  }
}

export type Deferred<T> = {
  promise: Promise<T>;
  resolve(value: T): void;
};

export function createDeferred<T>(): Deferred<T> {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((resolvePromise) => {
    resolve = resolvePromise;
  });
  return { promise, resolve };
}

export type TestBrowserLockRequest = {
  name: string;
  callback(): Promise<unknown>;
  resolve(value: unknown): void;
  reject(error: unknown): void;
  signal?: AbortSignal;
  activated: boolean;
  onAbort(): void;
};

export class TestBrowserLockManager {
  failQuery = false;
  private readonly held = new Map<string, TestBrowserLockRequest>();
  private readonly pending: TestBrowserLockRequest[] = [];

  request<T>(
    name: string,
    options: { mode: "exclusive"; signal?: AbortSignal },
    callback: () => Promise<T>,
  ): Promise<T> {
    if (options.signal?.aborted) {
      return Promise.reject(new DOMException("aborted", "AbortError"));
    }

    return new Promise<T>((resolve, reject) => {
      const request: TestBrowserLockRequest = {
        name,
        callback,
        resolve: (value) => resolve(value as T),
        reject,
        signal: options.signal,
        activated: false,
        onAbort: () => {
          if (request.activated) return;
          const index = this.pending.indexOf(request);
          if (index >= 0) {
            this.pending.splice(index, 1);
          }
          reject(new DOMException("aborted", "AbortError"));
        },
      };
      options.signal?.addEventListener("abort", request.onAbort, {
        once: true,
      });
      if (this.held.has(name)) {
        this.pending.push(request);
      } else {
        this.activate(request);
      }
    });
  }

  async query(): Promise<{
    held: Array<{ name: string }>;
    pending: Array<{ name: string }>;
  }> {
    if (this.failQuery) {
      throw new Error("lock query failed");
    }
    return {
      held: [...this.held.keys()].map((name) => ({ name })),
      pending: this.pending.map(({ name }) => ({ name })),
    };
  }

  hold(name: string): {
    entered: Promise<void>;
    release(): void;
    completed: Promise<void>;
  } {
    const entered = createDeferred<void>();
    const released = createDeferred<void>();
    const completed = this.request(
      name,
      { mode: "exclusive" },
      async () => {
        entered.resolve();
        await released.promise;
      },
    );
    return {
      entered: entered.promise,
      release: () => released.resolve(),
      completed,
    };
  }

  heldNames(): string[] {
    return [...this.held.keys()];
  }

  pendingNames(): string[] {
    return this.pending.map(({ name }) => name);
  }

  private activate(request: TestBrowserLockRequest): void {
    request.activated = true;
    request.signal?.removeEventListener("abort", request.onAbort);
    this.held.set(request.name, request);
    void Promise.resolve()
      .then(() => request.callback())
      .then(
        (value) => this.finish(request, value),
        (error) => this.finish(request, undefined, error),
      );
  }

  private finish(
    request: TestBrowserLockRequest,
    value: unknown,
    error?: unknown,
  ): void {
    if (this.held.get(request.name) === request) {
      this.held.delete(request.name);
    }
    if (error === undefined) {
      request.resolve(value);
    } else {
      request.reject(error);
    }
    const nextIndex = this.pending.findIndex(
      ({ name }) => name === request.name,
    );
    if (nextIndex >= 0) {
      const [next] = this.pending.splice(nextIndex, 1);
      this.activate(next);
    }
  }
}

export type TestChannel = {
  listeners: Set<(message: unknown) => void>;
  closed: boolean;
};

export class TestCoordinationChannelHub {
  failNextPost = false;
  private readonly channels = new Set<TestChannel>();

  create(): ReturnType<
    BrowserLedgerFileCoordinationEnvironment["createChannel"]
  > {
    const state: TestChannel = {
      listeners: new Set(),
      closed: false,
    };
    this.channels.add(state);
    return {
      postMessage: (message) => {
        if (this.failNextPost) {
          this.failNextPost = false;
          throw new DOMException("could not clone", "DataCloneError");
        }
        for (const channel of this.channels) {
          if (channel === state || channel.closed) continue;
          queueMicrotask(() => {
            for (const listener of channel.listeners) {
              listener(message);
            }
          });
        }
      },
      listen: (listener) => {
        state.listeners.add(listener);
        return () => state.listeners.delete(listener);
      },
      close: () => {
        state.closed = true;
        state.listeners.clear();
        this.channels.delete(state);
      },
    };
  }
}

export function createBrowserRuntimeHarness(responseTimeoutMs = 10) {
  const locks = new TestBrowserLockManager();
  const channels = new TestCoordinationChannelHub();
  let nextId = 0;
  let cloneFails = false;
  const environment: BrowserLedgerFileCoordinationEnvironment = {
    locks,
    createChannel: () => channels.create(),
    cloneHandle: () => {
      if (cloneFails) {
        throw new DOMException("could not clone", "DataCloneError");
      }
    },
    createId: () => {
      nextId += 1;
      return `browser-session-${nextId}`;
    },
    createAbortController: () => new AbortController(),
    setTimer: (callback, delayMs) => setTimeout(callback, delayMs),
    clearTimer: (timer) => clearTimeout(timer),
  };
  return {
    locks,
    channels,
    createRuntime: () =>
      new BrowserLedgerFileCoordinationRuntime(
        environment,
        responseTimeoutMs,
      ),
    setCloneFails(value: boolean) {
      cloneFails = value;
    },
  };
}

export const BROWSER_ADMISSION_LOCK =
  "local-first-trading-ledger:file-session:admission:v1";
export const BROWSER_SESSION_LOCK_PREFIX =
  "local-first-trading-ledger:file-session:active:v1:";
