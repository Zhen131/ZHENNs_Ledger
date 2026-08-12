// @vitest-environment jsdom

import { useState } from "react";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";

import {
  TradeDeleteControl,
  type TradeDeletePhase,
} from "./TradeDeleteControl";

afterEach(cleanup);

function Harness({ onConfirm }: Readonly<{ onConfirm: () => void }>) {
  const [phase, setPhase] = useState<TradeDeletePhase>("idle");
  return (
    <>
      <TradeDeleteControl
        ariaLabel="删除 买入 BTC 2026-07-20"
        onActivate={() => {
          if (phase === "armed") onConfirm();
          else setPhase("armed");
        }}
        onCancel={() => setPhase("idle")}
        onUndo={() => setPhase("idle")}
        phase={phase}
      />
      <button type="button">区域外</button>
    </>
  );
}

describe("TradeDeleteControl", () => {
  it("arms without executing and cancels from outside or Escape", async () => {
    const onConfirm = vi.fn();
    render(<Harness onConfirm={onConfirm} />);
    const user = userEvent.setup();
    const deleteButton = screen.getByRole("button", {
      name: "删除 买入 BTC 2026-07-20",
    });

    await user.click(deleteButton);
    expect(deleteButton.textContent).toBe("再次点击删除");
    expect(onConfirm).not.toHaveBeenCalled();
    await user.click(screen.getByRole("button", { name: "区域外" }));
    expect(deleteButton.textContent).toBe("删除");

    await user.click(deleteButton);
    fireEvent.keyDown(document, { key: "Escape" });
    expect(deleteButton.textContent).toBe("删除");
    expect(onConfirm).not.toHaveBeenCalled();
  });

  it("ignores keyboard repeats and executes once after two complete activations", async () => {
    const onConfirm = vi.fn();
    render(<Harness onConfirm={onConfirm} />);
    const user = userEvent.setup();
    const deleteButton = screen.getByRole("button", {
      name: "删除 买入 BTC 2026-07-20",
    });

    fireEvent.keyDown(deleteButton, { key: "Enter", repeat: true });
    fireEvent.click(deleteButton);
    expect(deleteButton.textContent).toBe("删除");
    expect(onConfirm).not.toHaveBeenCalled();

    await user.click(deleteButton);
    await user.click(deleteButton);
    expect(onConfirm).toHaveBeenCalledOnce();
  });

  it("renders countdown undo and persisting as distinct non-success states", async () => {
    const onUndo = vi.fn();
    const view = render(
      <TradeDeleteControl
        ariaLabel="删除 卖出 ETH 2026-07-21"
        onActivate={vi.fn()}
        onCancel={vi.fn()}
        onUndo={onUndo}
        phase="countdown"
        remainingMs={2_500}
      />,
    );
    const user = userEvent.setup();

    await user.click(
      screen.getByRole("button", {
        name: "撤回删除 卖出 ETH 2026-07-21",
      }),
    );
    expect(onUndo).toHaveBeenCalledOnce();

    view.rerender(
      <TradeDeleteControl
        ariaLabel="删除 卖出 ETH 2026-07-21"
        onActivate={vi.fn()}
        onCancel={vi.fn()}
        onUndo={onUndo}
        phase="persisting"
      />,
    );
    const saving = screen.getByRole("button", {
      name: "删除 卖出 ETH 2026-07-21正在保存",
    }) as HTMLButtonElement;
    expect(saving.disabled).toBe(true);
    expect(saving.textContent).toBe("正在保存…");
  });
});
