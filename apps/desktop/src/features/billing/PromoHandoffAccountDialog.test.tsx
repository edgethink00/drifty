// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { PromoHandoffAccountDialog } from "./PromoHandoffAccountDialog";

afterEach(cleanup);

describe("PromoHandoffAccountDialog", () => {
  it("contains focus and lets Escape keep the current account", async () => {
    const opener = document.createElement("button");
    opener.textContent = "Open account decision";
    document.body.append(opener);
    opener.focus();
    const onKeepAccount = vi.fn();

    const { unmount } = render(
      <PromoHandoffAccountDialog onKeepAccount={onKeepAccount} onSwitchAccount={vi.fn()} />,
    );

    const dialog = screen.getByRole("dialog", { name: /this account does not have the pass/i });
    await waitFor(() => expect(document.activeElement).toBe(dialog.querySelector(".modal-x")));
    fireEvent.keyDown(window, { key: "Escape" });
    expect(onKeepAccount).toHaveBeenCalledTimes(1);

    unmount();
    expect(document.activeElement).toBe(opener);
    opener.remove();
  });

  it("keeps the decision recoverable when account switching fails", async () => {
    const onSwitchAccount = vi.fn().mockRejectedValue(new Error("Sign out failed"));
    render(
      <PromoHandoffAccountDialog onKeepAccount={vi.fn()} onSwitchAccount={onSwitchAccount} />,
    );

    const dialog = screen.getByRole("dialog", { name: /this account does not have the pass/i });
    fireEvent.click(within(dialog).getByRole("button", { name: /^switch account$/i }));

    expect(onSwitchAccount).toHaveBeenCalledTimes(1);
    expect((await within(dialog).findByRole("alert")).textContent).toMatch(/couldn't sign out/i);
    expect(dialog.getAttribute("aria-busy")).toBe("false");
    expect(within(dialog).getByRole("button", { name: /^switch account$/i })).toHaveProperty("disabled", false);
  });
});
