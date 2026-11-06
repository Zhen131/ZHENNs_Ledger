/**
 * Checks an identifier supplied to a feature service: non-empty, at most 128
 * characters, and no leading or trailing whitespace.
 *
 * This is not the file-format check of the same name in `src/platform/files/`.
 * Those copies accept `unknown`, use different whitespace rules, and are part
 * of the ledger file contract; they are intentionally kept separate.
 */
export function isTechnicalId(value: string): boolean {
  return value.length > 0 && value.length <= 128 && value.trim() === value;
}
