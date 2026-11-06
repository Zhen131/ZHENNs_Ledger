/**
 * 这个文件管给一本账本的内容算一个指纹。
 * 用来判断两份内容是不是一模一样。
 * 它不管存文件，那在 files 区。
 * 不显然的决定：先查账本合不合法，不合法就不给指纹。这是猜的，日志里没写，要核。
 */

import type { LedgerData } from "@/core/models";
import { validateLedgerData } from "@/core/validation";

async function createSerializedContentIdentity(
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

/**
 * 这个函数回答：这本账本的内容指纹是什么？
 * 指纹是「内容的 SHA-256 + 字节数」，内容一样指纹就一样。
 * 举例：一本空账本 → 答 "（64 位十六进制）:（字节数）" 这样一串。
 * 账本不合法时，Promise 失败，不给指纹。
 */
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
