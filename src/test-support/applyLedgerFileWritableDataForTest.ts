import type { LedgerFileWritableData } from "@/platform/files";

export function applyLedgerFileWritableDataForTest(
  existing: Uint8Array,
  write: LedgerFileWritableData,
): Uint8Array {
  if (typeof write === "string") {
    return new TextEncoder().encode(write);
  }
  if (write instanceof Uint8Array) {
    return Uint8Array.from(write);
  }
  const end = write.position + write.data.byteLength;
  const next = new Uint8Array(Math.max(existing.byteLength, end));
  next.set(existing);
  next.set(write.data, write.position);
  return next;
}
