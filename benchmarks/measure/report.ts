export type DurationStatistics = Readonly<{
  medianMs: number;
  minimumMs: number;
  maximumMs: number;
  sampleCount: number;
}>;

export function summarizeDurations(
  samples: readonly number[],
): DurationStatistics {
  if (samples.length === 0) {
    throw new Error("At least one duration sample is required");
  }
  if (samples.some((sample) => !Number.isFinite(sample) || sample < 0)) {
    throw new Error("Duration samples must be finite and non-negative");
  }

  const sorted = [...samples].sort((left, right) => left - right);
  const middle = Math.floor(sorted.length / 2);
  const median =
    sorted.length % 2 === 0
      ? (sorted[middle - 1] + sorted[middle]) / 2
      : sorted[middle];

  return {
    medianMs: roundDuration(median),
    minimumMs: roundDuration(sorted[0]),
    maximumMs: roundDuration(sorted.at(-1)!),
    sampleCount: samples.length,
  };
}

export function roundDuration(value: number): number {
  return Math.round(value * 1_000) / 1_000;
}
