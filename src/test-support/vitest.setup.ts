/**
 * 这个文件管每个测试开跑前的准备。
 * 它放宽等待，重置界面语言，让两段字节按内容比。
 * 它不放测试样例，样例在同目录 `fixtures.ts`。
 * 不显然的决定：等待时间放宽到 3 秒，理由见下方。
 */
import { cleanup, configure } from "@testing-library/react";
import { afterEach, beforeEach, expect } from "vitest";

import {
  DEFAULT_LEDGER_LANGUAGE,
  LANGUAGE_PREFERENCE_STORAGE_KEY,
} from "@/ui";

// 为什么等待从默认 1 秒放到 3 秒：整套并行跑时机器很忙。1 秒常不够。
// 2026-11-06 提交 c4acaa9 写下这个理由。
configure({ asyncUtilTimeout: 3_000 });

if (typeof window !== "undefined") {
  try {
    if (typeof window.localStorage?.getItem !== "function") {
      Object.defineProperty(window, "localStorage", {
        configurable: true,
        value: createMemoryStorage(),
      });
    }
  } catch {
    Object.defineProperty(window, "localStorage", {
      configurable: true,
      value: createMemoryStorage(),
    });
  }
}

beforeEach(() => {
  try {
    if (typeof window === "undefined") return;
    window.localStorage.setItem(
      LANGUAGE_PREFERENCE_STORAGE_KEY,
      DEFAULT_LEDGER_LANGUAGE,
    );
  } catch {
    // 不在浏览器里跑的测试没有能用的存储；试存储坏掉的测试也没有。
  }
});

afterEach(() => {
  cleanup();
  try {
    if (typeof window === "undefined") return;
    window.localStorage.removeItem(LANGUAGE_PREFERENCE_STORAGE_KEY);
  } catch {
    // 试存储坏掉的测试要让坏掉的状态留着，所以这里不管。
  }
});

expect.addEqualityTesters([
  (left: unknown, right: unknown) => {
    if (!(left instanceof Uint8Array) || !(right instanceof Uint8Array)) {
      return undefined;
    }
    if (left.byteLength !== right.byteLength) {
      return false;
    }
    return Buffer.compare(
      Buffer.from(left.buffer, left.byteOffset, left.byteLength),
      Buffer.from(right.buffer, right.byteOffset, right.byteLength),
    ) === 0;
  },
]);

function createMemoryStorage(): Storage {
  const values = new Map<string, string>();
  return {
    get length() {
      return values.size;
    },
    clear: () => values.clear(),
    getItem: (key) => values.get(key) ?? null,
    key: (index) => Array.from(values.keys())[index] ?? null,
    removeItem: (key) => {
      values.delete(key);
    },
    setItem: (key, value) => {
      values.set(key, value);
    },
  };
}
