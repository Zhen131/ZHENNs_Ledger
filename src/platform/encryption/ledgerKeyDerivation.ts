/**
 * 这个文件管一件事：从密码和盐算出加密账本用的钥匙。
 * 它不管加密解密具体怎么做，那在 files 区的 ledgerFileCrypto.ts。
 * 不显然的决定：算法参数由调用方传进来，这里不写死。这是猜的，日志里没写，要核。
 */

/**
 * 浏览器加密功能里这里要用的两样。
 * 取随机数和加密工具箱。测试里可以换成假的。
 */
export type CryptoProvider = Pick<
  Crypto,
  "getRandomValues" | "subtle"
>;

/** 算钥匙用的参数：PBKDF2 加 SHA-256、算多少轮、AES-GCM、钥匙多长。 */
export type LedgerKeyDerivationParameters = Readonly<{
  kdfName: "PBKDF2";
  kdfHash: "SHA-256";
  kdfIterations: number;
  cipherName: "AES-GCM";
  keyLength: number;
}>;

/**
 * 这个函数回答：这个密码配这把盐，算出来的钥匙是哪把？
 * 同一个密码、同一把盐、同样参数，永远算出同一把钥匙。
 * 举例：密码 "correct horse"、16 字节的盐、轮数 600000 → 答一把 AES-GCM 钥匙。
 * 钥匙取不出原始字节，只能用来加密和解密。
 * 浏览器不支持这些算法时，Promise 失败。
 */
export async function deriveLedgerKeyWithParameters(
  passphrase: string,
  salt: Uint8Array,
  parameters: LedgerKeyDerivationParameters,
  cryptoProvider: CryptoProvider = globalThis.crypto,
): Promise<CryptoKey> {
  const baseKey = await cryptoProvider.subtle.importKey(
    "raw",
    new TextEncoder().encode(passphrase),
    parameters.kdfName,
    false,
    ["deriveKey"],
  );

  return cryptoProvider.subtle.deriveKey(
    {
      name: parameters.kdfName,
      hash: parameters.kdfHash,
      iterations: parameters.kdfIterations,
      salt: toArrayBuffer(salt),
    },
    baseKey,
    {
      name: parameters.cipherName,
      length: parameters.keyLength,
    },
    false,
    ["encrypt", "decrypt"],
  );
}

function toArrayBuffer(bytes: Uint8Array): ArrayBuffer {
  return Uint8Array.from(bytes).buffer;
}
