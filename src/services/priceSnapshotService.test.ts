import { describe, expect, it, vi } from "vitest";

import type { PriceSnapshotDraft } from "../models";
import { createInitialLedgerData } from "../state/initialLedgerData";
import { createPriceSnapshot } from "../test/fixtures";
import {
  PRICE_SNAPSHOT_SERVICE_ERROR_CODES,
  createValidatedPriceSnapshot,
  type PriceSnapshotServiceDependencies,
} from "./priceSnapshotService";

const TIMESTAMP = "2026-07-16T12:00:00.000Z";
const validDraft: PriceSnapshotDraft = {
  assetSymbol: "BTC",
  price: "70000",
  currency: "USD",
  recordedAt: "2026-07-16",
  source: "manual",
};

function createDependencies(ids: string[]): PriceSnapshotServiceDependencies {
  return {
    generateId: vi.fn(() => ids.shift() ?? "price-fallback"),
    now: vi.fn(() => TIMESTAMP),
  };
}

describe("createValidatedPriceSnapshot", () => {
  it("creates a formal snapshot from validated runtime input", () => {
    const dependencies = createDependencies(["price-new"]);
    const result = createValidatedPriceSnapshot(
      {
        ...validDraft,
        note: "manual close",
        id: "forged-id",
        createdAt: "2000-01-01T00:00:00Z",
      },
      createInitialLedgerData(),
      dependencies,
    );

    expect(result).toEqual({
      ok: true,
      priceSnapshot: {
        ...validDraft,
        note: "manual close",
        id: "price-new",
        createdAt: TIMESTAMP,
        updatedAt: TIMESTAMP,
      },
    });
  });

  it("returns validator errors before calling ID or time dependencies", () => {
    const dependencies = createDependencies(["unused"]);
    const result = createValidatedPriceSnapshot(
      { ...validDraft, price: "0" },
      createInitialLedgerData(),
      dependencies,
    );

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.kind).toBe("validation");
    }
    expect(dependencies.generateId).not.toHaveBeenCalled();
    expect(dependencies.now).not.toHaveBeenCalled();
  });

  it("retries ID collisions and succeeds within three attempts", () => {
    const ledgerData = {
      ...createInitialLedgerData(),
      priceSnapshots: [
        createPriceSnapshot("price-existing", "BTC", "69000", "2026-07-15"),
      ],
    };
    const dependencies = createDependencies([
      "price-existing",
      "price-new",
    ]);

    const result = createValidatedPriceSnapshot(
      validDraft,
      ledgerData,
      dependencies,
    );

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.priceSnapshot.id).toBe("price-new");
    }
    expect(dependencies.generateId).toHaveBeenCalledTimes(2);
  });

  it("returns a stable service error after three ID collisions", () => {
    const ledgerData = {
      ...createInitialLedgerData(),
      priceSnapshots: [
        createPriceSnapshot("collision", "BTC", "69000", "2026-07-15"),
      ],
    };
    const dependencies = createDependencies([
      "collision",
      "collision",
      "collision",
    ]);

    expect(
      createValidatedPriceSnapshot(validDraft, ledgerData, dependencies),
    ).toEqual({
      ok: false,
      kind: "service",
      error: {
        code: PRICE_SNAPSHOT_SERVICE_ERROR_CODES.ID_GENERATION_EXHAUSTED,
        message: expect.any(String),
      },
    });
    expect(dependencies.now).not.toHaveBeenCalled();
  });

  it("reports dependency failures without throwing", () => {
    const dependencies: PriceSnapshotServiceDependencies = {
      generateId: vi.fn(() => "price-new"),
      now: vi.fn(() => {
        throw new Error("clock unavailable");
      }),
    };

    expect(
      createValidatedPriceSnapshot(
        validDraft,
        createInitialLedgerData(),
        dependencies,
      ),
    ).toEqual({
      ok: false,
      kind: "service",
      error: {
        code: PRICE_SNAPSHOT_SERVICE_ERROR_CODES.DEPENDENCY_FAILURE,
        operation: "now",
        message: expect.any(String),
      },
    });
  });
});
