import { describe, expect, it } from "vitest";

import { base64UrlToBytes, bytesToBase64Url } from "./cryptoEncoding";

describe("Base64URL encoding", () => {
  it(
    "round-trips empty, binary, and large payloads without padding",
    () => {
      const fixtures = [
        new Uint8Array(),
        new Uint8Array([0, 1, 2, 127, 128, 254, 255]),
        Uint8Array.from({ length: 8 * 1024 * 1024 }, (_, index) =>
          index % 251,
        ),
      ];

      for (const fixture of fixtures) {
        const encoded = bytesToBase64Url(fixture);
        expect(encoded).not.toContain("=");
        expect(base64UrlToBytes(encoded)).toEqual(fixture);
      }
    },
    15_000,
  );

  it.each(["=", "AQ==", "A", "AQ+", "AQ/", "AQ!", "AB"])(
    "rejects invalid or non-canonical input %s",
    (value) => {
      expect(() => base64UrlToBytes(value)).toThrow();
    },
  );
});
