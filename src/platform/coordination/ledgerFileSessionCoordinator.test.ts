import { describe, expect, it, vi } from "vitest";
import {
  DefaultLedgerFileSessionCoordinator,
} from "./ledgerFileSessionCoordinator";
import {
  IdentityFileHandle,
  FakeCoordinationRuntime,
  createDeferred,
} from "./ledgerFileSessionCoordinator.testHelpers";

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
