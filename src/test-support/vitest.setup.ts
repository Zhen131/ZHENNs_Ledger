import { expect } from "vitest";

expect.addEqualityTesters([
  (left: unknown, right: unknown) => {
    if (!(left instanceof Uint8Array) || !(right instanceof Uint8Array)) {
      return undefined;
    }
    if (left.byteLength !== right.byteLength) {
      return false;
    }
    return Buffer.compare(
      Buffer.from(left.buffer, left.byteOffset, left.byteLength),
      Buffer.from(right.buffer, right.byteOffset, right.byteLength),
    ) === 0;
  },
]);
