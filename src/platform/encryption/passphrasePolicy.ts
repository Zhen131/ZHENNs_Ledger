/**
 * 这个文件管一件事：账本密码长度合不合规矩。
 * 它不管密码对不对，那要等解密时才知道。
 * 不显然的决定：按字符数算，不按字节算，一个汉字算一个。
 * 理由是从界面写法推的（W13 02A 第三节）：界面写「8 至 128 个 Unicode 字符」。
 * 按你看到的个数算，才和这句对得上。
 */

/**
 * 密码长度上下限：最少 8 个字符，最多 128 个。
 * 为什么最少 8：这个密码每次打开账本都要输，12 个太长；8 个是常见网站的下限。
 * 2026-11-15 拟稿，产品负责人看过、未改字（W26 00A 追加节）。
 * 为什么最多 128：这是猜的，日志里没写，要核。
 * 8～128 这条规矩见 W13 02A 第三节（2026-08-13），原来是 12～128。
 */
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
