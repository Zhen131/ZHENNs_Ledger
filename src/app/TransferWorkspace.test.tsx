// @vitest-environment jsdom

import { useEffect } from "react";
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { TransferWorkspace } from "./TransferWorkspace";

afterEach(cleanup);

describe("TransferWorkspace", () => {
  it("keeps the plaintext warning visible and separates it from encrypted lftl wording", () => {
    render(
      <TransferWorkspace
        active
        backupPanel={<button type="button">backup panel sentinel</button>}
        storageKind="ledger-file"
      />,
    );

    expect(screen.getByText(/当前 .lftl 是加密正式账本/)).not.toBeNull();
    expect(screen.getByText(/明文备份包含完整资产/)).not.toBeNull();
    expect(screen.getByText("导出明文账本")).not.toBeNull();
    expect(screen.getByText("预检并完整替换")).not.toBeNull();
    expect(
      screen.getByRole("button", { name: "backup panel sentinel" }),
    ).not.toBeNull();
  });

  it("unmounts the stateful backup panel when the user leaves the page", () => {
    const onUnmount = vi.fn();
    function StatefulPanel() {
      useEffect(() => () => onUnmount(), []);
      return <p>stateful import</p>;
    }
    const view = render(
      <TransferWorkspace
        active
        backupPanel={<StatefulPanel />}
        storageKind="ledger-file"
      />,
    );

    view.rerender(
      <TransferWorkspace
        active={false}
        backupPanel={<StatefulPanel />}
        storageKind="ledger-file"
      />,
    );
    expect(onUnmount).toHaveBeenCalledOnce();
  });
});
