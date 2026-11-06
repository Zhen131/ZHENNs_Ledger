/**
 * 这个文件只放一个类型：开机读账本读到哪一步了。
 * 读账本的过程在同目录 `usePersistentLedgerLifecycle.ts`。
 * 没有特别的决定。
 */
/** 开机读账本的三种状态：正在读、读好了、读失败。 */
export type HydrationStatus = "loading" | "ready" | "error";
