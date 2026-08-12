import type { LedgerData } from "@/core/models";
import { validateLedgerData } from "@/core/validation";

export async function createSerializedContentIdentity(
  serialized: string,
): Promise<string> {
  const bytes = new TextEncoder().encode(serialized);
  const digest = await globalThis.crypto.subtle.digest(
    "SHA-256",
    bytes as BufferSource,
  );
  const sha256 = [...new Uint8Array(digest)]
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
  return `${sha256}:${bytes.byteLength}`;
}

export function createLedgerDataContentIdentity(
  ledgerData: LedgerData,
): Promise<string> {
  const validation = validateLedgerData(ledgerData);
  if (!validation.ok) {
    return Promise.reject(
      new Error("Cannot create an identity for invalid LedgerData"),
    );
  }
  return createSerializedContentIdentity(
    JSON.stringify(validation.value),
  );
}
