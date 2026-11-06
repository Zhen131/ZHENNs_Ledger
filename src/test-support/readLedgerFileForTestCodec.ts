/**
 * 这个文件管测试里账本文件的字节和文字来回转。
 * 它不解析文件内容，解析在同目录 `readLedgerFileForTest.ts`。
 * 不显然的决定：二进制转成文字时，原字节记进小缓存。
 * 转回来时先查缓存，原样取回。
 */
import { isLedgerFileV3Bytes } from "@/platform/files";

/** 小缓存最多记几份文件，8 份。为什么是 8：这是猜的，日志里没写，要核。 */
const TEST_BINARY_STRING_CACHE_LIMIT = 8;
const testBinaryStringBytes = new Map<string, Uint8Array>();

/**
 * 这个函数把账本文件的字节变成测试好比较的文字。
 * 老的 JSON 文件按 UTF-8 解码。
 * V3 二进制文件一个字节变一个字符，原字节进缓存。
 * 举例：开头是 "LFTL3\r\n\0" 的文件 → 答同样开头的文字。
 * JSON 文件里有坏的 UTF-8 时抛错。
 */
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

/**
 * 这个函数把上面那种文字变回字节。
 * 开头是 "LFTL3\r\n\0" 的，先去缓存找原字节。
 * 缓存里没有，就一个字符变一个字节。
 * 别的文字按 UTF-8 编码。
 * 举例：把刚转出的文字传回 → 答和原来一样的字节。
 * 不会出错。
 */
export function ledgerFileTestStringToBytes(value: string): Uint8Array {
  if (!value.startsWith("LFTL3\r\n\0")) {
    return new TextEncoder().encode(value);
  }
  const cached = testBinaryStringBytes.get(value);
  return cached
    ? Uint8Array.from(cached)
    : Uint8Array.from(value, (character) => character.charCodeAt(0));
}
