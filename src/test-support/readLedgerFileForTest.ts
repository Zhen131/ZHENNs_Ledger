import {
  type LedgerFileV2,
  validateLedgerFileV2,
} from "@/platform/files";

/**
 * Centralizes format-dependent inspection of files emitted by the current
 * product. S-1 extends this boundary when the product begins emitting V3.
 */
export function readLedgerFileForTest(
  input: string | Uint8Array,
): LedgerFileV2 {
  const serialized =
    typeof input === "string"
      ? input
      : new TextDecoder("utf-8", { fatal: true }).decode(input);
  let parsed: unknown;
  try {
    parsed = JSON.parse(serialized);
  } catch (error) {
    throw new Error("Test ledger file is not valid JSON", {
      cause: error,
    });
  }
  const validated = validateLedgerFileV2(parsed);
  if (!validated.ok) {
    throw new Error("Test ledger file failed the V2 contract", {
      cause: validated.errors,
    });
  }
  return validated.value;
}
