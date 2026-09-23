import { describe, expect, it } from "vitest";
import {
  DefaultLedgerFileSessionCoordinator,
} from "./ledgerFileSessionCoordinator";
import {
  IdentityFileHandle,
  createDeferred,
  createBrowserRuntimeHarness,
  BROWSER_ADMISSION_LOCK,
  BROWSER_SESSION_LOCK_PREFIX,
} from "./ledgerFileSessionCoordinator.testHelpers";

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
