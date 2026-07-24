export const PASSPHRASE_POLICY = {
  minimumCodePoints: 12,
  maximumCodePoints: 128,
} as const;

export type PassphraseValidationResult =
  | { ok: true }
  | {
      ok: false;
      code: "PASSPHRASE_LENGTH_INVALID";
    };

export function validatePassphrase(
  passphrase: string,
): PassphraseValidationResult {
  const codePointLength = Array.from(passphrase).length;

  if (
    codePointLength < PASSPHRASE_POLICY.minimumCodePoints ||
    codePointLength > PASSPHRASE_POLICY.maximumCodePoints
  ) {
    return { ok: false, code: "PASSPHRASE_LENGTH_INVALID" };
  }

  return { ok: true };
}
