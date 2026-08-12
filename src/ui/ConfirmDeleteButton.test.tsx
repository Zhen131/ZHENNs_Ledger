// @vitest-environment jsdom

import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";

import { ConfirmDeleteButton } from "./ConfirmDeleteButton";

afterEach(cleanup);

function renderButton(
  onConfirm: () =>
    | "applied"
    | "rejected"
    | "noop"
    | Promise<"applied" | "rejected" | "noop">,
  disabled = false,
) {
  return render(
    <div>
      <ConfirmDeleteButton
        ariaLabel="删除测试记录"
        disabled={disabled}
        label="删除"
        onConfirm={onConfirm}
      />
      <button type="button">外部按钮</button>
    </div>,
  );
}

describe("ConfirmDeleteButton", () => {
  it("changes only local state on first activation and confirms exactly once on second activation", async () => {
    const user = userEvent.setup();
    const onConfirm = vi.fn(() => "applied" as const);
    renderButton(onConfirm);
    const button = screen.getByRole("button", { name: "删除测试记录" });

    await user.click(button);
    expect(onConfirm).not.toHaveBeenCalled();
    expect(button.textContent).toBe("再次点击确认");
    expect(button.getAttribute("aria-pressed")).toBe("true");

    await user.click(button);
    expect(onConfirm).toHaveBeenCalledOnce();
    expect(button.textContent).toBe("删除");
    expect(button.getAttribute("aria-pressed")).toBe("false");
  });

  it("cancels armed state on outside pointerdown, Escape, or disabled changes", async () => {
    const user = userEvent.setup();
    const onConfirm = vi.fn(() => "applied" as const);
    const view = renderButton(onConfirm);
    const button = screen.getByRole("button", { name: "删除测试记录" });

    await user.click(button);
    await user.click(screen.getByRole("button", { name: "外部按钮" }));
    expect(button.textContent).toBe("删除");

    await user.click(button);
    await user.keyboard("{Escape}");
    expect(button.textContent).toBe("删除");

    await user.click(button);
    view.rerender(
      <ConfirmDeleteButton
        ariaLabel="删除测试记录"
        disabled
        label="删除"
        onConfirm={onConfirm}
      />,
    );
    expect(
      screen.getByRole("button", { name: "删除测试记录" }).textContent,
    ).toBe("删除");
    expect(onConfirm).not.toHaveBeenCalled();
  });

  it("supports keyboard confirmation but ignores repeated keydown activation", async () => {
    const user = userEvent.setup();
    const onConfirm = vi.fn(() => "applied" as const);
    renderButton(onConfirm);
    const button = screen.getByRole("button", { name: "删除测试记录" });
    button.focus();

    await user.keyboard("{Enter}");
    expect(button.textContent).toBe("再次点击确认");
    fireEvent.keyDown(button, { key: "Enter", repeat: true });
    fireEvent.click(button);
    expect(onConfirm).not.toHaveBeenCalled();

    await user.keyboard("{Enter}");
    expect(onConfirm).toHaveBeenCalledOnce();
  });

  it("exposes busy state and blocks duplicate confirmation while a Promise is pending", async () => {
    const user = userEvent.setup();
    let resolve!: (outcome: "applied") => void;
    const onConfirm = vi.fn(
      () =>
        new Promise<"applied">((resolvePromise) => {
          resolve = resolvePromise;
        }),
    );
    renderButton(onConfirm);
    const button = screen.getByRole("button", { name: "删除测试记录" });

    await user.click(button);
    await user.click(button);
    expect(button.getAttribute("aria-busy")).toBe("true");
    expect((button as HTMLButtonElement).disabled).toBe(true);
    fireEvent.click(button);
    expect(onConfirm).toHaveBeenCalledOnce();

    resolve("applied");
    await waitFor(() => {
      expect(button.getAttribute("aria-busy")).toBe("false");
    });
  });

  it("includes the reduced-motion override without changing delete semantics", () => {
    renderButton(() => "noop");
    const button = screen.getByRole("button", { name: "删除测试记录" });

    expect(button.className).toContain("duration-[180ms]");
    expect(button.className).toContain("motion-reduce:transition-none");
    expect(button.className).toContain("motion-reduce:transform-none");
  });
});
