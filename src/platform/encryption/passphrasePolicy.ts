/**
 * 这个文件管一件事：账本密码长度合不合规矩。
 * 它不管密码对不对，那要等解密时才知道。
 * 不显然的决定：按字符数算，不按字节算，一个汉字算一个。这是猜的，日志里没写，要核。
 */

/** 密码长度上下限：最少 8 个字符，最多 128 个。为什么是这两个数：这是猜的，日志里没写，要核。 */
const PASSPHRASE_POLICY = {
  minimumCodePoints: 8,
  maximumCodePoints: 128,
} as const;

type PassphraseValidationResult =
  | { ok: true }
  | {
      ok: false;
      code: "PASSPHRASE_LENGTH_INVALID";
    };

/**
 * 这个函数回答：这个密码长度能不能用？
 * 举例："1234567" 只有 7 个字符 → 答不能；"我的账本密码一二" 8 个字 → 答能。
 * 不抛错，不合规矩时返回 ok:false 和 `PASSPHRASE_LENGTH_INVALID`。
 */
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
