import { cleanup } from "@testing-library/react";
import { afterEach, beforeEach, expect } from "vitest";

import {
  DEFAULT_LEDGER_LANGUAGE,
  LANGUAGE_PREFERENCE_STORAGE_KEY,
} from "@/ui";

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
    // Node tests and storage-failure tests intentionally have no usable storage.
  }
});

afterEach(() => {
  cleanup();
  try {
    if (typeof window === "undefined") return;
    window.localStorage.removeItem(LANGUAGE_PREFERENCE_STORAGE_KEY);
  } catch {
    // Storage-failure tests intentionally keep the failing boundary in place.
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
