/**
 * 这个文件管一件事：交易页和几个记录列表怎么分页。
 * 列表怎么画在各自的组件里。
 * 不显然的决定：一页 100 条，选 100 是多留余量。
 * 2026-08-29 定（W15 05A 第 2.1 节）。
 */
/**
 * 一页放几条记录，100 条。
 * 为什么是 100：100 条约 5 毫秒画完，200 条约 11 毫秒，人感觉不出差别。
 * 选 100 是多留余量，不是 200 有风险；2026-08-29 定（W15 05A 第 2.1 节）。
 */
export const ACTIVITY_PAGE_SIZE = 100;

/**
 * 这个函数回答：这么多条记录一共几页？
 * 举例：250 条 → 答 3 页；0 条 → 答 1 页。
 * 不会出错。
 */
export function getActivityPageCount(itemCount: number): number {
  return Math.max(1, Math.ceil(itemCount / ACTIVITY_PAGE_SIZE));
}

/**
 * 这个函数回答：第几页上是哪几条？
 * 举例：250 条里的第 3 页 → 答第 201～250 条。
 * 页码超出时返回空。
 */
export function getActivityPageItems<T>(
  items: readonly T[],
  page: number,
): readonly T[] {
  const start = (page - 1) * ACTIVITY_PAGE_SIZE;
  return items.slice(start, start + ACTIVITY_PAGE_SIZE);
}
