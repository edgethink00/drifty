// @vitest-environment jsdom

import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { useState } from "react";
import { describe, expect, it, vi } from "vitest";
import { AccountDeletionModal } from "./AccountDeletionModal";

describe("AccountDeletionModal", () => {
  it("moves focus into the confirmation, traps Tab, and restores the opener", async () => {
    function Harness() {
      const [open, setOpen] = useState(false);
      return (
        <>
          <button type="button" onClick={() => setOpen(true)}>Open deletion</button>
          {open ? (
            <AccountDeletionModal
              accountEmail="alex@example.com"
              onClose={() => setOpen(false)}
              onDelete={vi.fn().mockResolvedValue({ success: true, localDataRetained: true })}
            />
          ) : null}
        </>
      );
    }

    render(<Harness />);
    const opener = screen.getByRole("button", { name: "Open deletion" });
    opener.focus();
    fireEvent.click(opener);

    const dialog = screen.getByRole("dialog", { name: "Delete Drifty account" });
    const confirmation = screen.getByRole("textbox", { name: /Type alex@example.com to confirm/i });
    await waitFor(() => expect(document.activeElement).toBe(confirmation));

    fireEvent.change(confirmation, { target: { value: "alex@example.com" } });
    const closeButton = screen.getAllByRole("button", { name: /^Cancel$/i })[0];
    const deleteButton = screen.getByRole("button", { name: /^Delete permanently$/i });
    deleteButton.focus();
    fireEvent.keyDown(dialog, { key: "Tab" });
    expect(document.activeElement).toBe(closeButton);

    closeButton.focus();
    fireEvent.keyDown(dialog, { key: "Tab", shiftKey: true });
    expect(document.activeElement).toBe(deleteButton);

    fireEvent.click(closeButton);
    await waitFor(() => expect(screen.queryByRole("dialog", { name: "Delete Drifty account" })).toBeNull());
    expect(document.activeElement).toBe(opener);
  });

  it("requires the signed-in email and explains cloud deletion versus local retention", async () => {
    const onClose = vi.fn();
    const onDelete = vi.fn().mockResolvedValue({ success: true, localDataRetained: true });
    render(<AccountDeletionModal accountEmail="alex@example.com" onClose={onClose} onDelete={onDelete} />);

    expect(screen.getByText(/Pro subscription ends immediately/i)).toBeTruthy();
    expect(screen.getByText(/another member’s project totals.*blocked instead/i)).toBeTruthy();
    expect(screen.getByText(/Polar retains anonymized historical billing records/i)).toBeTruthy();
    expect(screen.getByText(/Activity history and locally saved work or setup state.*not deleted/i)).toBeTruthy();
    expect(screen.getByText(/retained history can be uploaded to that account/i)).toBeTruthy();
    expect(screen.getByText(/analytics already sent to PostHog are not deleted/i)).toBeTruthy();
    const input = screen.getByRole("textbox", { name: /Type alex@example.com to confirm/i });
    const deleteButton = screen.getByRole("button", { name: /^Delete permanently$/i });
    expect(deleteButton.hasAttribute("disabled")).toBe(true);

    fireEvent.change(input, { target: { value: "  ALEX@example.com " } });
    expect(deleteButton.hasAttribute("disabled")).toBe(false);
    fireEvent.click(deleteButton);

    await waitFor(() => expect(onDelete).toHaveBeenCalledWith("ALEX@example.com"));
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("keeps the dialog open and retryable when deletion fails", async () => {
    const onClose = vi.fn();
    const onDelete = vi.fn().mockResolvedValue({
      success: false,
      code: "cloud_purge_failed",
      stage: "billing_stopped",
      error: "Cloud purge failed.",
    });
    render(<AccountDeletionModal accountEmail="alex@example.com" onClose={onClose} onDelete={onDelete} />);

    fireEvent.change(screen.getByRole("textbox"), { target: { value: "alex@example.com" } });
    const deleteButton = screen.getByRole("button", { name: /^Delete permanently$/i });
    fireEvent.click(deleteButton);

    expect((await screen.findByRole("alert")).textContent).toContain("Billing cleanup is complete");
    expect(onClose).not.toHaveBeenCalled();
    expect(screen.getByRole("button", { name: /^Delete permanently$/i }).hasAttribute("disabled")).toBe(false);
  });

  it("preserves confirmed billing shutdown while treating final account state as unknown", async () => {
    const onDelete = vi.fn().mockResolvedValue({
      success: false,
      code: "account_state_unknown",
      stage: "billing_stopped",
      error: "wrapped Auth failure",
    });
    render(<AccountDeletionModal accountEmail="alex@example.com" onClose={vi.fn()} onDelete={onDelete} />);

    fireEvent.change(screen.getByRole("textbox"), { target: { value: "alex@example.com" } });
    fireEvent.click(screen.getByRole("button", { name: /^Delete permanently$/i }));

    expect((await screen.findByRole("alert")).textContent).toMatch(/Billing cleanup is complete.*could not confirm/i);
  });

  it("uses DELETE for an anonymous account and discloses legacy billing cleanup without Pro or team claims", async () => {
    const onDelete = vi.fn().mockResolvedValue({ success: true, localDataRetained: true });
    render(
      <AccountDeletionModal
        accountEmail={null}
        isAnonymousAccount
        onClose={vi.fn()}
        onDelete={onDelete}
      />,
    );

    expect(screen.getByText(/billing customer linked to this guest identity.*cloud profile and published leaderboard data/i)).toBeTruthy();
    expect(screen.queryByText(/Pro subscription ends immediately/i)).toBeNull();
    expect(screen.queryByText(/Teams beta/i)).toBeNull();
    const input = screen.getByRole("textbox", { name: /Type DELETE to confirm/i });
    fireEvent.change(input, { target: { value: "DELETE" } });
    fireEvent.click(screen.getByRole("button", { name: /^Delete permanently$/i }));
    await waitFor(() => expect(onDelete).toHaveBeenCalledWith("DELETE"));
  });

  it("describes anonymous partial cleanup without claiming that a subscription existed", async () => {
    const onDelete = vi.fn().mockResolvedValue({
      success: false,
      code: "cloud_purge_failed",
      stage: "billing_stopped",
      error: "Cloud purge failed.",
    });
    render(
      <AccountDeletionModal
        accountEmail={null}
        isAnonymousAccount
        onClose={vi.fn()}
        onDelete={onDelete}
      />,
    );

    fireEvent.change(screen.getByRole("textbox"), { target: { value: "DELETE" } });
    fireEvent.click(screen.getByRole("button", { name: /^Delete permanently$/i }));

    const error = await screen.findByRole("alert");
    expect(error.textContent).toContain("billing customer linked to this guest identity has been cleared");
    expect(error.textContent).not.toMatch(/subscription/i);
  });

  it("describes an anonymous unknown account outcome without claiming that a subscription existed", async () => {
    const onDelete = vi.fn().mockResolvedValue({
      success: false,
      code: "account_state_unknown",
      stage: "billing_stopped",
      error: "wrapped Auth failure",
    });
    render(
      <AccountDeletionModal
        accountEmail={null}
        isAnonymousAccount
        onClose={vi.fn()}
        onDelete={onDelete}
      />,
    );

    fireEvent.change(screen.getByRole("textbox"), { target: { value: "DELETE" } });
    fireEvent.click(screen.getByRole("button", { name: /^Delete permanently$/i }));

    const error = await screen.findByRole("alert");
    expect(error.textContent).toMatch(/guest account deletion finished.*Contact support/i);
    expect(error.textContent).not.toMatch(/subscription/i);
  });

  it("blocks a shared-team owner without promising a support resolution", async () => {
    const onDelete = vi.fn().mockResolvedValue({
      success: false,
      code: "shared_team_owner",
      stage: "not_started",
      error: "Shared team owner.",
    });
    render(<AccountDeletionModal accountEmail="alex@example.com" onClose={vi.fn()} onDelete={onDelete} />);

    fireEvent.change(screen.getByRole("textbox"), { target: { value: "alex@example.com" } });
    fireEvent.click(screen.getByRole("button", { name: /^Delete permanently$/i }));

    const error = await screen.findByRole("alert");
    expect(error.textContent).toMatch(/blocked to protect other members' data/i);
    expect(error.textContent).not.toMatch(/contact support/i);
  });

  it("locks every dismissal path while deletion is in flight and recovers from an unexpected rejection", async () => {
    const onClose = vi.fn();
    let rejectDeletion: ((error: Error) => void) | undefined;
    const onDelete = vi.fn().mockImplementation(() => new Promise((_, reject) => {
      rejectDeletion = reject;
    }));
    render(<AccountDeletionModal accountEmail="alex@example.com" onClose={onClose} onDelete={onDelete} />);

    fireEvent.change(screen.getByRole("textbox"), { target: { value: "alex@example.com" } });
    const deleteButton = screen.getByRole("button", { name: /^Delete permanently$/i });
    fireEvent.click(deleteButton);

    const dialog = screen.getByRole("dialog");
    expect(dialog.getAttribute("aria-busy")).toBe("true");
    await waitFor(() => expect(document.activeElement).toBe(dialog));
    const cancelButtons = screen.getAllByRole("button", { name: /^Cancel$/i });
    expect(cancelButtons.every((button) => button.hasAttribute("disabled"))).toBe(true);
    expect(deleteButton.hasAttribute("disabled")).toBe(true);
    fireEvent.click(cancelButtons[0]);
    fireEvent.keyDown(dialog, { key: "Tab" });
    expect(document.activeElement).toBe(dialog);
    expect(onClose).not.toHaveBeenCalled();

    rejectDeletion?.(new Error("network disconnected"));
    expect((await screen.findByRole("alert")).textContent).toContain("couldn't finish deleting your account");
    expect(screen.getByRole("dialog").getAttribute("aria-busy")).toBe("false");
    expect(screen.getAllByRole("button", { name: /^Cancel$/i }).every((button) => !button.hasAttribute("disabled"))).toBe(true);
  });

  it("finishes the typed confirmation with Enter only once it matches", async () => {
    const onDelete = vi.fn().mockResolvedValue({ success: true, localDataRetained: true });
    render(<AccountDeletionModal accountEmail="alex@example.com" onClose={vi.fn()} onDelete={onDelete} />);
    const confirmation = screen.getByRole("textbox", { name: /Type alex@example.com to confirm/i });
    const deleteButton = screen.getByRole("button", { name: /^Delete permanently$/i });
    expect(deleteButton.getAttribute("aria-keyshortcuts")).toBe("Enter");

    fireEvent.change(confirmation, { target: { value: "alex@example" } });
    fireEvent.keyDown(confirmation, { key: "Enter" });
    expect(onDelete).not.toHaveBeenCalled();

    fireEvent.change(confirmation, { target: { value: "alex@example.com" } });
    fireEvent.keyDown(confirmation, { key: "Enter", keyCode: 229 });
    expect(onDelete).not.toHaveBeenCalled();

    fireEvent.keyDown(confirmation, { key: "Enter" });
    await waitFor(() => expect(onDelete).toHaveBeenCalledWith("alex@example.com"));
  });
});
