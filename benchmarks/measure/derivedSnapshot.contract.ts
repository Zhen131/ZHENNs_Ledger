import { describe, expect, it } from "vitest";

import {
  compareDerivedSnapshots,
  createDerivedSnapshot,
  DERIVED_SNAPSHOT_SCALES,
  readFrozenDerivedSnapshot,
} from "./derivedSnapshot";

describe("derived result snapshot contract", () => {
  it.each(DERIVED_SNAPSHOT_SCALES)(
    "T1-03 compares two unchanged %s snapshots as identical",
    (scale) => {
      expect(
        compareDerivedSnapshots(
          createDerivedSnapshot(scale),
          createDerivedSnapshot(scale),
        ).equal,
      ).toBe(true);
    },
    180_000,
  );

  it("T1-04 detects one deliberately changed fact", () => {
    const expected = createDerivedSnapshot("S-100");
    const actual = {
      ...expected,
      derived: {
        ...expected.derived,
        projection: {
          ...expected.derived.projection,
          positions: expected.derived.projection.positions.map(
            (position, index) =>
              index === 0 ? { ...position, quantity: "999" } : position,
          ),
        },
      },
    };

    expect(compareDerivedSnapshots(expected, actual).equal).toBe(false);
  });

  it.each(DERIVED_SNAPSHOT_SCALES)(
    "matches the frozen %s snapshot byte-for-byte",
    async (scale) => {
      const frozen = await readFrozenDerivedSnapshot(scale);
      expect(compareDerivedSnapshots(frozen, createDerivedSnapshot(scale)).equal).toBe(
        true,
      );
    },
    180_000,
  );
});
