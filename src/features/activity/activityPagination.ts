export const ACTIVITY_PAGE_SIZE = 100;

export function getActivityPageCount(itemCount: number): number {
  return Math.max(1, Math.ceil(itemCount / ACTIVITY_PAGE_SIZE));
}

export function getActivityPageItems<T>(
  items: readonly T[],
  page: number,
): readonly T[] {
  const start = (page - 1) * ACTIVITY_PAGE_SIZE;
  return items.slice(start, start + ACTIVITY_PAGE_SIZE);
}
