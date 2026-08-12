// @vitest-environment jsdom

import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { FileStatusIndicator } from "./FileStatusIndicator";
import { InlineFeedback } from "./InlineFeedback";
import { LedgerIcon } from "./LedgerIcon";
import { SurfaceCard } from "./SurfaceCard";

describe("ledger visual primitives", () => {
  it("keeps decorative icons out of the accessibility tree and labels standalone icons", () => {
    const { rerender } = render(<LedgerIcon data-testid="icon" name="home" />);
    expect(screen.getByTestId("icon").getAttribute("aria-hidden")).toBe("true");

    rerender(<LedgerIcon name="lock" title="锁定账本" />);
    expect(screen.getByRole("img", { name: "锁定账本" })).toBeTruthy();
  });

  it("renders semantic surface, file status and non-colour feedback", () => {
    render(
      <SurfaceCard aria-label="概览卡">
        <FileStatusIndicator label="已保存" tone="saved" />
        <InlineFeedback tone="error">保存失败，请重试</InlineFeedback>
      </SurfaceCard>,
    );

    expect(screen.getByRole("region", { name: "概览卡" })).toBeTruthy();
    expect(screen.getByRole("status").textContent).toContain("已保存");
    expect(screen.getByRole("alert").textContent).toContain("保存失败");
  });
});
