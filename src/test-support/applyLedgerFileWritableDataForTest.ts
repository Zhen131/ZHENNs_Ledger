/**
 * 这个文件给测试一个假的「写进文件」动作。
 * 它不碰真的文件句柄，真写文件在 `platform/files` 里。
 * 没有特别的决定。
 */
import type { LedgerFileWritableData } from "@/platform/files";

/**
 * 这个函数回答：一次写入落到旧字节上，文件变成什么样？
 * 写入是整段文字或整段字节，就整体换掉。
 * 写入是「从第几个字节起写一段」，就只盖住那一段。
 * 盖到旧文件末尾之外时，文件跟着变长。
 * 举例：旧文件 10 字节，从第 8 字节起写 4 个 → 答 12 字节。
 * 测试拿它模拟真文件写完的样子。不会出错。
 */
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
