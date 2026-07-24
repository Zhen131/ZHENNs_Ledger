import { describe, expect, it } from "vitest";

import { NoopEncryptionService } from "./noopEncryptionService";

describe("NoopEncryptionService", () => {
  it("preserves plaintext through the encrypt/decrypt contract", async () => {
    const service = new NoopEncryptionService();
    const plaintext = '{"schemaVersion":1,"trades":[]}';

    const envelope = await service.encrypt(plaintext);
    const decryptedPayload = await service.decrypt(envelope);

    expect(envelope).toMatchObject({ formatVersion: 2 });
    expect(decryptedPayload).toBe(plaintext);
  });

  it("preserves Unicode and empty strings exactly", async () => {
    const service = new NoopEncryptionService();

    const unicodeEnvelope = await service.encrypt("账本数据");
    const emptyEnvelope = await service.encrypt("");

    await expect(service.decrypt(unicodeEnvelope)).resolves.toBe(
      "账本数据",
    );
    await expect(service.decrypt(emptyEnvelope)).resolves.toBe("");
  });
});
