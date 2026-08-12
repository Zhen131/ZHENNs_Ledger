const BASE64URL_PATTERN = /^[A-Za-z0-9_-]*$/;
const BYTE_CHUNK_SIZE = 0x8000;

export function bytesToBase64Url(bytes: Uint8Array): string {
  let binary = "";

  for (let offset = 0; offset < bytes.length; offset += BYTE_CHUNK_SIZE) {
    const chunk = bytes.subarray(offset, offset + BYTE_CHUNK_SIZE);
    binary += String.fromCharCode.apply(null, Array.from(chunk));
  }

  return btoa(binary)
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");
}

export function base64UrlToBytes(value: string): Uint8Array {
  if (!BASE64URL_PATTERN.test(value) || value.includes("=")) {
    throw new Error("Invalid Base64URL");
  }

  const remainder = value.length % 4;

  if (remainder === 1) {
    throw new Error("Invalid Base64URL length");
  }

  const padding = remainder === 0 ? "" : "=".repeat(4 - remainder);
  const standard = value.replace(/-/g, "+").replace(/_/g, "/") + padding;
  let binary: string;

  try {
    binary = atob(standard);
  } catch {
    throw new Error("Invalid Base64URL");
  }

  const bytes = new Uint8Array(binary.length);

  for (let index = 0; index < binary.length; index += 1) {
    bytes[index] = binary.charCodeAt(index);
  }

  if (bytesToBase64Url(bytes) !== value) {
    throw new Error("Non-canonical Base64URL");
  }

  return bytes;
}
