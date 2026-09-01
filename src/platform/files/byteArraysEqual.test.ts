import { describe, expect, it } from "vitest";

import { byteArraysEqual } from "./byteArraysEqual";

describe("byteArraysEqual", () => {
  it("compares aligned words and trailing bytes exactly", () => {
    const left = Uint8Array.from([1, 2, 3, 4, 5, 6, 7]);
    const right = Uint8Array.from(left);

    expect(byteArraysEqual(left, right)).toBe(true);
    right[6] = 8;
    expect(byteArraysEqual(left, right)).toBe(false);
  });

  it("compares unaligned views exactly", () => {
    const leftBacking = Uint8Array.from([9, 1, 2, 3, 4, 5, 8]);
    const rightBacking = Uint8Array.from([7, 7, 1, 2, 3, 4, 5]);
    const left = leftBacking.subarray(1, 6);
    const right = rightBacking.subarray(2);

    expect(byteArraysEqual(left, right)).toBe(true);
    right[2] = 6;
    expect(byteArraysEqual(left, right)).toBe(false);
  });

  it("rejects arrays with different lengths", () => {
    expect(
      byteArraysEqual(Uint8Array.of(1), Uint8Array.of(1, 2)),
    ).toBe(false);
  });
});
