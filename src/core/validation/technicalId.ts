/**
 * 这个文件管一件事：功能区收到的编号像不像样。
 * 它不管账本文件里的编号检查，那是 platform/files 里另一份同名检查。
 * 不显然的决定：两份故意分开，文件格式那份规矩不同。这是猜的，日志里没写，要核。
 */

/**
 * 这个函数回答：一个编号能不能用？
 * 不能是空的，最多 128 个字，前后不能有空格。
 * 举例：" abc" → 答不能用；"trade-1" → 答能用。
 *
 * 为什么最多 128 个字：2026-08-19 定（W14 01B 第 3.5 节）。
 * 它和 platform/files 里同名的检查不是一回事。
 * 那几份收任意值，空格规矩也不同。
 * 它们是文件格式的一部分，故意分开。
 */
export function isTechnicalId(value: string): boolean {
  return value.length > 0 && value.length <= 128 && value.trim() === value;
}
