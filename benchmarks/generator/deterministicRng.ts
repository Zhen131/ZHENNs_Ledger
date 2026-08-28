export type DeterministicSeed = number | string;

export type DeterministicRng = Readonly<{
  next: () => number;
  integer: (minimum: number, maximum: number) => number;
}>;

export function createDeterministicRng(seed: DeterministicSeed): DeterministicRng {
  let state = normalizeSeed(seed);

  function next(): number {
    state ^= state << 13;
    state ^= state >>> 17;
    state ^= state << 5;
    state >>>= 0;
    return state / 0x1_0000_0000;
  }

  return {
    next,
    integer(minimum: number, maximum: number): number {
      if (!Number.isInteger(minimum) || !Number.isInteger(maximum)) {
        throw new Error("Deterministic integer bounds must be integers");
      }
      if (maximum < minimum) {
        throw new Error("Deterministic integer maximum must be at least minimum");
      }
      return minimum + Math.floor(next() * (maximum - minimum + 1));
    },
  };
}

function normalizeSeed(seed: DeterministicSeed): number {
  if (typeof seed === "number") {
    if (!Number.isFinite(seed)) {
      throw new Error("Deterministic seed must be finite");
    }
    return (Math.trunc(seed) >>> 0) || 0x6d2b_79f5;
  }

  let hash = 2_166_136_261;
  for (let index = 0; index < seed.length; index += 1) {
    hash ^= seed.charCodeAt(index);
    hash = Math.imul(hash, 16_777_619);
  }
  return (hash >>> 0) || 0x6d2b_79f5;
}
