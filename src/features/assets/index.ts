/**
 * 这个文件是资产区的逻辑入口，把 assetService 转出去。
 * 现在没有代码从这里引用；页面只用 `@/features/assets/ui`。
 * 为什么留着：目录守卫 sourceLayout 要求每个功能目录都有 index.ts。
 * 所以 knip.json 只把这一个文件列进忽略，不删它。
 * 2026-11-15 定（W26 01B 复审后修订第 2 条）。
 */
export * from "./assetService";
