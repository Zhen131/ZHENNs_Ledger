/**
 * 这个文件只做一件事。
 * 把「给账本内容算指纹」的函数转交出去。
 * 真正的算法在 ledgerContentIdentity.ts，这里不写逻辑。
 * 没有特别的决定。
 */

export { createLedgerDataContentIdentity } from "./ledgerContentIdentity";
