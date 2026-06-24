import { expect, test } from "vitest";

test("runs TypeScript tests in the Node environment", () => {
  expect(typeof process.version).toBe("string");
  expect(typeof window).toBe("undefined");
});
