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
        ariaLabel="Delete test record"
        disabled={disabled}
        label="Delete"
        onConfirm={onConfirm}
      />
      <button type="button">External button</button>
    </div>,
  );
}

describe("ConfirmDeleteButton", () => {
  it("changes only local state on first activation and confirms exactly once on second activation", async () => {
    const user = userEvent.setup();
    const onConfirm = vi.fn(() => "applied" as const);
    renderButton(onConfirm);
    const button = screen.getByRole("button", { name: "Delete test record" });

    await user.click(button);
    expect(onConfirm).not.toHaveBeenCalled();
    expect(button.textContent).toBe("Click again to confirm");
    expect(button.getAttribute("aria-pressed")).toBe("true");

    await user.click(button);
    expect(onConfirm).toHaveBeenCalledOnce();
    expect(button.textContent).toBe("Delete");
    expect(button.getAttribute("aria-pressed")).toBe("false");
  });

  it("cancels armed state on outside pointerdown, Escape, or disabled changes", async () => {
    const user = userEvent.setup();
    const onConfirm = vi.fn(() => "applied" as const);
    const view = renderButton(onConfirm);
    const button = screen.getByRole("button", { name: "Delete test record" });

    await user.click(button);
    await user.click(screen.getByRole("button", { name: "External button" }));
    expect(button.textContent).toBe("Delete");

    await user.click(button);
    await user.keyboard("{Escape}");
    expect(button.textContent).toBe("Delete");

    await user.click(button);
    view.rerender(
      <ConfirmDeleteButton
        ariaLabel="Delete test record"
        disabled
        label="Delete"
        onConfirm={onConfirm}
      />,
    );
    expect(
      screen.getByRole("button", { name: "Delete test record" }).textContent,
    ).toBe("Delete");
    expect(onConfirm).not.toHaveBeenCalled();
  });

  it("supports keyboard confirmation but ignores repeated keydown activation", async () => {
    const user = userEvent.setup();
    const onConfirm = vi.fn(() => "applied" as const);
    renderButton(onConfirm);
    const button = screen.getByRole("button", { name: "Delete test record" });
    button.focus();

    await user.keyboard("{Enter}");
    expect(button.textContent).toBe("Click again to confirm");
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
    const button = screen.getByRole("button", { name: "Delete test record" });

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
    const button = screen.getByRole("button", { name: "Delete test record" });

    expect(button.className).toContain("duration-[180ms]");
    expect(button.className).toContain("motion-reduce:transition-none");
    expect(button.className).toContain("motion-reduce:transform-none");
  });
});
