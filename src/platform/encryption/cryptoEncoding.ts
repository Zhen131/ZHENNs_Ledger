/**
 * 这个文件管一件事。
 * 一串字节和网址安全的 Base64 文字之间来回换。
 * 它不管加密本身，那在 ledgerKeyDerivation.ts 和 files 区。
 * 不显然的决定。
 * 读回时只认唯一写法，多一个等号或写法不标准都拒绝。这是猜的，日志里没写，要核。
 */

const BASE64URL_PATTERN = /^[A-Za-z0-9_-]*$/;
const BYTE_CHUNK_SIZE = 0x8000;

/**
 * 这个函数把一串字节写成网址安全的 Base64 文字。
 * 不带末尾等号。
 * 举例：字节 [255, 254] → 答 "__4"。
 * 不会出错。
 */
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

/**
 * 这个函数把网址安全的 Base64 文字读回成字节。
 * 举例："__4" → 答字节 [255, 254]；"__4=" → 抛错。
 * 有等号、有不认识的字符时抛错。
 * 长度不对、写法不标准时也抛错。
 * 调用方一般把它当成「文件坏了」处理。
 */
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
