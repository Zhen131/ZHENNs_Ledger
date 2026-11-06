/**
 * 这个文件给测试一个手动控制的 Promise。
 * 它不管具体等的是什么活，那由各个测试自己定。
 * 没有特别的决定。
 */
/** 一个能从外面叫完成或叫失败的 Promise，连同那两个开关。 */
export type Deferred<T> = {
  promise: Promise<T>;
  resolve: (value: T) => void;
  reject: (reason?: unknown) => void;
};

/**
 * 这个函数造一个什么时候完成由测试说了算的 Promise。
 * 测试拿它卡住一个异步动作，再在想要的时机放行。
 * 举例：交给假的读文件；测试调 `resolve("ok")` → 读文件这才答 "ok"。
 * 不会出错。
 */
export function createDeferred<T>(): Deferred<T> {
  let resolve!: (value: T) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, resolve, reject };
}
