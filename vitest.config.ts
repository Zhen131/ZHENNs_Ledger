import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "node",
    include: ["src/**/*.test.ts"],
    exclude: [
      "src/calculators/positionCalculator.test.ts",
      "src/utils/decimalMath.test.ts",
      "src/validators/tradeValidator.test.ts",
    ],
  },
});
