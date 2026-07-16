import { describe, expect, it } from "vitest";

import { NoopEncryptionService } from "./noopEncryptionService";

describe("NoopEncryptionService", () => {
  it("preserves plaintext through the encrypt/decrypt contract", async () => {
    const service = new NoopEncryptionService();
    const plaintext = '{"schemaVersion":1,"trades":[]}';

    const encryptedPayload = await service.encrypt(plaintext);
    const decryptedPayload = await service.decrypt(encryptedPayload);

    expect(encryptedPayload).toBe(plaintext);
    expect(decryptedPayload).toBe(plaintext);
  });

  it("preserves Unicode and empty strings exactly", async () => {
    const service = new NoopEncryptionService();

    await expect(service.encrypt("账本数据")).resolves.toBe("账本数据");
    await expect(service.decrypt("")).resolves.toBe("");
  });
});
