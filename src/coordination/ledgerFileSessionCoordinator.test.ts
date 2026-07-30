import { describe, expect, it, vi } from "vitest";

import type {
  LedgerFileHandle,
  LedgerFileWritable,
} from "../adapters/ledgerFileHandleAdapter";
import {
  BrowserLedgerFileCoordinationRuntime,
  DefaultLedgerFileSessionCoordinator,
  type BrowserLedgerFileCoordinationEnvironment,
  type LedgerFileCoordinationRuntime,
  type LedgerFileCoordinationRuntimeLease,
  type LedgerFileEntryComparison,
} from "./ledgerFileSessionCoordinator";

class IdentityFileHandle implements LedgerFileHandle {
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

type ActiveRuntimeLease = {
  handle: LedgerFileHandle;
  lease: FakeRuntimeLease;
};

class FakeCoordinationRuntime implements LedgerFileCoordinationRuntime {
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

class FakeRuntimeLease implements LedgerFileCoordinationRuntimeLease {
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

type Deferred<T> = {
  promise: Promise<T>;
  resolve(value: T): void;
};

function createDeferred<T>(): Deferred<T> {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((resolvePromise) => {
    resolve = resolvePromise;
  });
  return { promise, resolve };
}

type TestBrowserLockRequest = {
  name: string;
  callback(): Promise<unknown>;
  resolve(value: unknown): void;
  reject(error: unknown): void;
  signal?: AbortSignal;
  activated: boolean;
  onAbort(): void;
};

class TestBrowserLockManager {
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

type TestChannel = {
  listeners: Set<(message: unknown) => void>;
  closed: boolean;
};

class TestCoordinationChannelHub {
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

function createBrowserRuntimeHarness(responseTimeoutMs = 10) {
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

describe("DefaultLedgerFileSessionCoordinator", () => {
  it("serializes simultaneous admission and rejects the same actual file immediately", async () => {
    const runtime = new FakeCoordinationRuntime();
    const firstCoordinator =
      new DefaultLedgerFileSessionCoordinator(runtime);
    const secondCoordinator =
      new DefaultLedgerFileSessionCoordinator(runtime);
    const firstHandle = new IdentityFileHandle("actual-file");
    const secondHandle = new IdentityFileHandle("actual-file");

    const [first, second] = await Promise.all([
      firstCoordinator.acquire(firstHandle),
      secondCoordinator.acquire(secondHandle),
    ]);

    expect(first.status).toBe("acquired");
    expect(second).toEqual({ status: "in-use" });
    expect(runtime.active.size).toBe(1);
  });

  it("allows different entries and a byte-copy with the same fileId", async () => {
    const runtime = new FakeCoordinationRuntime();
    const coordinator =
      new DefaultLedgerFileSessionCoordinator(runtime);
    const original = await coordinator.acquire(
      new IdentityFileHandle("original", "shared-file-id"),
    );
    const copy = await coordinator.acquire(
      new IdentityFileHandle("copy", "shared-file-id"),
    );

    expect(original.status).toBe("acquired");
    expect(copy.status).toBe("acquired");
    expect(runtime.active.size).toBe(2);
  });

  it("requires an explicit retry after the holder releases", async () => {
    const runtime = new FakeCoordinationRuntime();
    const coordinator =
      new DefaultLedgerFileSessionCoordinator(runtime);
    const first = await coordinator.acquire(
      new IdentityFileHandle("actual-file"),
    );
    expect(first.status).toBe("acquired");
    if (first.status !== "acquired") return;

    await expect(
      coordinator.acquire(new IdentityFileHandle("actual-file")),
    ).resolves.toEqual({ status: "in-use" });
    await first.lease.release();
    const retry = await coordinator.acquire(
      new IdentityFileHandle("actual-file"),
    );
    expect(retry.status).toBe("acquired");
  });

  it("fails closed for missing capability, clone failure, comparison failure, query failure, and hold failure", async () => {
    const unsupportedRuntime = new FakeCoordinationRuntime();
    unsupportedRuntime.supported = false;
    await expect(
      new DefaultLedgerFileSessionCoordinator(
        unsupportedRuntime,
      ).acquire(new IdentityFileHandle("a")),
    ).resolves.toEqual({ status: "unsupported" });

    const cloneRuntime = new FakeCoordinationRuntime();
    cloneRuntime.cloneFails = true;
    await expect(
      new DefaultLedgerFileSessionCoordinator(cloneRuntime).acquire(
        new IdentityFileHandle("a"),
      ),
    ).resolves.toEqual({ status: "unsupported" });

    const comparisonRuntime = new FakeCoordinationRuntime();
    const comparisonCoordinator =
      new DefaultLedgerFileSessionCoordinator(comparisonRuntime);
    const holder = await comparisonCoordinator.acquire(
      new IdentityFileHandle("holder", "id", true),
    );
    expect(holder.status).toBe("acquired");
    await expect(
      comparisonCoordinator.acquire(
        new IdentityFileHandle("candidate"),
      ),
    ).resolves.toEqual({ status: "coordination-failed" });

    const queryRuntime = new FakeCoordinationRuntime();
    queryRuntime.listFails = true;
    await expect(
      new DefaultLedgerFileSessionCoordinator(queryRuntime).acquire(
        new IdentityFileHandle("a"),
      ),
    ).resolves.toEqual({ status: "coordination-failed" });

    const holdRuntime = new FakeCoordinationRuntime();
    holdRuntime.holdFails = true;
    await expect(
      new DefaultLedgerFileSessionCoordinator(holdRuntime).acquire(
        new IdentityFileHandle("a"),
      ),
    ).resolves.toEqual({ status: "coordination-failed" });
  });

  it("serializes short writes, waits for accepted writes on release, and rejects later writes", async () => {
    const runtime = new FakeCoordinationRuntime();
    const result = await new DefaultLedgerFileSessionCoordinator(
      runtime,
    ).acquire(new IdentityFileHandle("actual-file"));
    expect(result.status).toBe("acquired");
    if (result.status !== "acquired") return;

    const firstWrite = createDeferred<void>();
    const first = result.lease.runExclusiveWrite(async () => {
      await firstWrite.promise;
      return "first";
    });
    const secondOperation = vi.fn(async () => "second");
    const second = result.lease.runExclusiveWrite(secondOperation);
    const release = result.lease.release();

    await Promise.resolve();
    expect(secondOperation).not.toHaveBeenCalled();
    expect(runtime.active.size).toBe(1);
    firstWrite.resolve();
    await expect(Promise.all([first, second])).resolves.toEqual([
      "first",
      "second",
    ]);
    await release;
    expect(runtime.active.size).toBe(0);
    await expect(
      result.lease.runExclusiveWrite(async () => undefined),
    ).rejects.toThrow(/released/);
  });

  it("makes release idempotent and prevents an old lease from releasing a newer session", async () => {
    const runtime = new FakeCoordinationRuntime();
    const coordinator =
      new DefaultLedgerFileSessionCoordinator(runtime);
    const first = await coordinator.acquire(
      new IdentityFileHandle("actual-file"),
    );
    expect(first.status).toBe("acquired");
    if (first.status !== "acquired") return;

    const firstRelease = first.lease.release();
    expect(first.lease.release()).toBe(firstRelease);
    await firstRelease;
    const second = await coordinator.acquire(
      new IdentityFileHandle("actual-file"),
    );
    expect(second.status).toBe("acquired");
    await first.lease.release();

    await expect(
      coordinator.acquire(new IdentityFileHandle("actual-file")),
    ).resolves.toEqual({ status: "in-use" });
  });

  it("keeps writes closed but permits an explicit release retry after the runtime reports failure", async () => {
    const runtime = new FakeCoordinationRuntime();
    const result = await new DefaultLedgerFileSessionCoordinator(
      runtime,
    ).acquire(new IdentityFileHandle("actual-file"));
    expect(result.status).toBe("acquired");
    if (result.status !== "acquired") return;
    const runtimeLease = [...runtime.active.values()][0]?.lease;
    expect(runtimeLease).toBeDefined();
    if (!runtimeLease) return;
    runtimeLease.failNextRelease = true;

    await expect(result.lease.release()).rejects.toThrow(
      "runtime release failed",
    );
    expect(runtime.active.size).toBe(1);
    await expect(
      result.lease.runExclusiveWrite(async () => undefined),
    ).rejects.toThrow(/released/);

    await expect(result.lease.release()).resolves.toBeUndefined();
    expect(runtime.active.size).toBe(0);
  });
});

const BROWSER_ADMISSION_LOCK =
  "local-first-trading-ledger:file-session:admission:v1";
const BROWSER_SESSION_LOCK_PREFIX =
  "local-first-trading-ledger:file-session:active:v1:";

describe("BrowserLedgerFileCoordinationRuntime", () => {
  it("reports held sessions and rejects a pending session-lock snapshot", async () => {
    const harness = createBrowserRuntimeHarness();
    const runtime = harness.createRuntime();
    const sessionLock = `${BROWSER_SESSION_LOCK_PREFIX}holder`;
    const holder = harness.locks.hold(sessionLock);
    await holder.entered;

    await expect(runtime.listActiveSessionIds()).resolves.toEqual([
      "holder",
    ]);

    const pending = harness.locks.request(
      sessionLock,
      { mode: "exclusive" },
      async () => undefined,
    );
    expect(harness.locks.pendingNames()).toContain(sessionLock);
    await expect(runtime.listActiveSessionIds()).rejects.toThrow(
      /pending/,
    );

    holder.release();
    await holder.completed;
    await pending;
    await expect(runtime.listActiveSessionIds()).resolves.toEqual([]);
  });

  it("fails closed when the production lock query fails", async () => {
    const harness = createBrowserRuntimeHarness();
    harness.locks.failQuery = true;
    const coordinator = new DefaultLedgerFileSessionCoordinator(
      harness.createRuntime(),
    );

    await expect(
      coordinator.acquire(new IdentityFileHandle("candidate")),
    ).resolves.toEqual({ status: "coordination-failed" });
  });

  it("fails closed when a probe cannot be posted", async () => {
    const harness = createBrowserRuntimeHarness();
    const ghost = harness.locks.hold(
      `${BROWSER_SESSION_LOCK_PREFIX}ghost`,
    );
    await ghost.entered;
    harness.channels.failNextPost = true;
    const coordinator = new DefaultLedgerFileSessionCoordinator(
      harness.createRuntime(),
    );

    await expect(
      coordinator.acquire(new IdentityFileHandle("candidate")),
    ).resolves.toEqual({ status: "coordination-failed" });

    ghost.release();
    await ghost.completed;
  });

  it("fails closed when the active holder cannot compare entries", async () => {
    const harness = createBrowserRuntimeHarness();
    const holderRuntime = harness.createRuntime();
    const holderLease = await holderRuntime.holdSession(
      "holder",
      new IdentityFileHandle("holder", "file-id", true),
    );
    const coordinator = new DefaultLedgerFileSessionCoordinator(
      harness.createRuntime(),
    );

    await expect(
      coordinator.acquire(new IdentityFileHandle("candidate")),
    ).resolves.toEqual({ status: "coordination-failed" });

    const release = holderLease.release();
    expect(holderLease.release()).toBe(release);
    await release;
  });

  it("requires an explicit retry after an unresponsive holder lock disappears", async () => {
    const harness = createBrowserRuntimeHarness(5);
    const crashedHolder = harness.locks.hold(
      `${BROWSER_SESSION_LOCK_PREFIX}crashed-holder`,
    );
    await crashedHolder.entered;
    const coordinator = new DefaultLedgerFileSessionCoordinator(
      harness.createRuntime(),
    );

    await expect(
      coordinator.acquire(new IdentityFileHandle("candidate")),
    ).resolves.toEqual({ status: "coordination-failed" });

    crashedHolder.release();
    await crashedHolder.completed;
    const retry = await coordinator.acquire(
      new IdentityFileHandle("candidate"),
    );
    expect(retry.status).toBe("acquired");
    if (retry.status === "acquired") {
      await retry.lease.release();
    }
  });

  it("finishes accepted writes, survives admission contention, and fully releases the session lock", async () => {
    const harness = createBrowserRuntimeHarness(5);
    const coordinator = new DefaultLedgerFileSessionCoordinator(
      harness.createRuntime(),
    );
    const acquired = await coordinator.acquire(
      new IdentityFileHandle("holder"),
    );
    expect(acquired.status).toBe("acquired");
    if (acquired.status !== "acquired") return;

    const writeStarted = createDeferred<void>();
    const finishWrite = createDeferred<void>();
    const acceptedWrite = acquired.lease.runExclusiveWrite(async () => {
      writeStarted.resolve();
      await finishWrite.promise;
      return "saved";
    });
    await writeStarted.promise;

    const admissionHolder = harness.locks.hold(
      BROWSER_ADMISSION_LOCK,
    );
    await admissionHolder.entered;
    const release = acquired.lease.release();
    expect(acquired.lease.release()).toBe(release);
    await expect(
      acquired.lease.runExclusiveWrite(async () => "late"),
    ).rejects.toThrow(/released/);

    finishWrite.resolve();
    await expect(acceptedWrite).resolves.toBe("saved");
    await Promise.resolve();
    expect(harness.locks.pendingNames()).toContain(
      BROWSER_ADMISSION_LOCK,
    );
    expect(
      harness.locks
        .heldNames()
        .some((name) => name.startsWith(BROWSER_SESSION_LOCK_PREFIX)),
    ).toBe(true);

    const competingCoordinator =
      new DefaultLedgerFileSessionCoordinator(
        harness.createRuntime(),
      );
    await expect(
      competingCoordinator.acquire(
        new IdentityFileHandle("contender"),
      ),
    ).resolves.toEqual({ status: "coordination-failed" });

    admissionHolder.release();
    await admissionHolder.completed;
    await release;
    expect(
      harness.locks
        .heldNames()
        .some((name) => name.startsWith(BROWSER_SESSION_LOCK_PREFIX)),
    ).toBe(false);
    expect(
      harness.locks
        .pendingNames()
        .some((name) => name.startsWith(BROWSER_SESSION_LOCK_PREFIX)),
    ).toBe(false);
  });
});
