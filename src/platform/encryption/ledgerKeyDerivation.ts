export type CryptoProvider = Pick<
  Crypto,
  "getRandomValues" | "subtle"
>;

export type LedgerKeyDerivationParameters = Readonly<{
  kdfName: "PBKDF2";
  kdfHash: "SHA-256";
  kdfIterations: number;
  cipherName: "AES-GCM";
  keyLength: number;
}>;

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
