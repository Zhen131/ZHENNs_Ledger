// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";

import {
  PUBLIC_CLEAR_LEDGER_CONFIRMATION_TEXT,
  SettingsWorkspace,
} from "./SettingsWorkspace";

afterEach(cleanup);

function renderSettings(onClear = vi.fn(async () => true)) {
  return {
    onClear,
    ...render(
      <SettingsWorkspace
        active
        canClearHydrationError={false}
        canClearReadyLedger
        feePanel={<p>fee panel sentinel</p>}
        hydrationStatus="ready"
        isReadOnly={false}
        ledgerEpoch={1}
        marketPanel={<p>market panel sentinel</p>}
        onClear={onClear}
        persistenceOperation="idle"
        repositorySwitchBlocked={false}
        storageKind="ledger-file"
      />,
    ),
  };
}

describe("SettingsWorkspace", () => {
  it("renders one settings category at a time and defaults to market mappings", async () => {
    renderSettings();
    const user = userEvent.setup();

    expect(screen.getByText("market panel sentinel")).not.toBeNull();
    expect(screen.queryByText("fee panel sentinel")).toBeNull();
    await user.click(screen.getByRole("tab", { name: "手续费规则" }));
    expect(screen.getByText("fee panel sentinel")).not.toBeNull();
    expect(screen.queryByText("market panel sentinel")).toBeNull();
  });

  it("keeps the public clear phrase separate from the internal clear callback", async () => {
    const { onClear } = renderSettings();
    const user = userEvent.setup();

    await user.click(screen.getByRole("tab", { name: "危险操作" }));
    await user.click(
      screen.getByRole("button", { name: "打开清空账本操作" }),
    );
    const input = screen.getByLabelText("输入清空确认文本");
    await user.type(input, "清空当前C账本");
    await user.click(
      screen.getByRole("button", { name: "确认清空账本内容" }),
    );
    expect(onClear).not.toHaveBeenCalled();
    expect(
      screen.getByText(
        `请输入完整确认文本“${PUBLIC_CLEAR_LEDGER_CONFIRMATION_TEXT}”`,
      ),
    ).not.toBeNull();

    await user.clear(input);
    await user.type(input, PUBLIC_CLEAR_LEDGER_CONFIRMATION_TEXT);
    await user.click(
      screen.getByRole("button", { name: "确认清空账本内容" }),
    );
    expect(onClear).toHaveBeenCalledOnce();
    expect(onClear).toHaveBeenCalledWith("normal");
    expect(
      await screen.findByText("当前账本内容已清空，.lftl 文件仍然存在"),
    ).not.toBeNull();
  });

  it("closes a dangerous confirmation with Escape without calling clear", async () => {
    const { onClear } = renderSettings();
    const user = userEvent.setup();

    await user.click(screen.getByRole("tab", { name: "危险操作" }));
    const trigger = screen.getByRole("button", {
      name: "打开清空账本操作",
    });
    await user.click(trigger);
    fireEvent.keyDown(document, { key: "Escape" });

    expect(screen.queryByRole("region", { name: "清空账本确认" })).toBeNull();
    expect(onClear).not.toHaveBeenCalled();
  });
});
