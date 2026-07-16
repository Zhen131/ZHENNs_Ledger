/**
 * 加密位于 Repository 与 StorageAdapter 之间的唯一边界。
 *
 * Week 7 使用 Noop；未来替换 WebCrypto 时上层接口保持不变。
 */
export interface EncryptionService {
  encrypt(plaintext: string): Promise<string>;
  decrypt(encryptedPayload: string): Promise<string>;
}
