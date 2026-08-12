import { describe, expect, it } from "vitest";

import { validatePassphrase } from "./passphrasePolicy";

describe("passphrase policy", () => {
  it("accepts 12 through 128 Unicode code points", () => {
    expect(validatePassphrase("a".repeat(12))).toEqual({ ok: true });
    expect(validatePassphrase("🔐".repeat(12))).toEqual({ ok: true });
    expect(validatePassphrase("a".repeat(128))).toEqual({ ok: true });
  });

  it("rejects values outside the exact code-point limits", () => {
    expect(validatePassphrase("a".repeat(11)).ok).toBe(false);
    expect(validatePassphrase("🔐".repeat(129)).ok).toBe(false);
  });

  it("does not trim or normalize the passphrase", () => {
    expect(validatePassphrase("          ab").ok).toBe(true);
    expect(validatePassphrase("short      ").ok).toBe(false);
  });
});
