import type { EncryptionService } from "./encryptionService";

/**
 * Week 7 的结构占位实现。
 *
 * 它不会提供保密性，只保证未来替换 WebCrypto 时无需修改 Repository。
 */
export class NoopEncryptionService implements EncryptionService {
  async encrypt(plaintext: string): Promise<string> {
    return plaintext;
  }

  async decrypt(encryptedPayload: string): Promise<string> {
    return encryptedPayload;
  }
}
