import { isLedgerFileV3Bytes } from "@/platform/files";

const TEST_BINARY_STRING_CACHE_LIMIT = 8;
const testBinaryStringBytes = new Map<string, Uint8Array>();

export function ledgerFileWritableDataToBytes(
  data: string | Uint8Array,
): Uint8Array {
  return typeof data === "string"
    ? new TextEncoder().encode(data)
    : Uint8Array.from(data);
}

export function ledgerFileBytesToTestString(bytes: Uint8Array): string {
  if (!isLedgerFileV3Bytes(bytes)) {
    return new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  }
  const chunks: string[] = [];
  for (let offset = 0; offset < bytes.byteLength; offset += 8_192) {
    chunks.push(
      String.fromCharCode(...bytes.subarray(offset, offset + 8_192)),
    );
  }
  const value = chunks.join("");
  testBinaryStringBytes.set(value, Uint8Array.from(bytes));
  while (testBinaryStringBytes.size > TEST_BINARY_STRING_CACHE_LIMIT) {
    testBinaryStringBytes.delete(testBinaryStringBytes.keys().next().value!);
  }
  return value;
}

export function ledgerFileTestStringToBytes(value: string): Uint8Array {
  if (!value.startsWith("LFTL3\r\n\0")) {
    return new TextEncoder().encode(value);
  }
  const cached = testBinaryStringBytes.get(value);
  return cached
    ? Uint8Array.from(cached)
    : Uint8Array.from(value, (character) => character.charCodeAt(0));
}
