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
