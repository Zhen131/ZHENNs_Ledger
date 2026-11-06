/**
 * 这个文件管一件事：比两串字节是不是一模一样。
 * 它不管字节代表什么，调用方在 files 区的读写和复查里。
 * 不显然的决定：能对齐时四个字节一组比，为了快。这是猜的，日志里没写，要核。
 */

/**
 * 这个函数回答：两串字节是不是一个不差？
 * 举例：[1, 2, 3] 和 [1, 2, 3] → 答是；[1, 2, 3] 和 [1, 2, 4] → 答不是。
 * 长度不同直接答不是。不会出错。
 */
export function byteArraysEqual(
  left: Uint8Array,
  right: Uint8Array,
): boolean {
  if (left.byteLength !== right.byteLength) return false;

  const byteLength = left.byteLength;
  if (
    left.byteOffset % Uint32Array.BYTES_PER_ELEMENT === 0 &&
    right.byteOffset % Uint32Array.BYTES_PER_ELEMENT === 0
  ) {
    const wordLength = Math.floor(
      byteLength / Uint32Array.BYTES_PER_ELEMENT,
    );
    const leftWords = new Uint32Array(
      left.buffer,
      left.byteOffset,
      wordLength,
    );
    const rightWords = new Uint32Array(
      right.buffer,
      right.byteOffset,
      wordLength,
    );
    for (let index = 0; index < wordLength; index += 1) {
      if (leftWords[index] !== rightWords[index]) return false;
    }
    for (
      let index = wordLength * Uint32Array.BYTES_PER_ELEMENT;
      index < byteLength;
      index += 1
    ) {
      if (left[index] !== right[index]) return false;
    }
    return true;
  }

  for (let index = 0; index < byteLength; index += 1) {
    if (left[index] !== right[index]) return false;
  }
  return true;
}
