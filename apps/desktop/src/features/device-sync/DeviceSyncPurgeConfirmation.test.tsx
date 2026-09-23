// @vitest-environment jsdom

import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { useState } from "react";
import { describe, expect, it, vi } from "vitest";

import { DeviceSyncPurgeConfirmation } from "./DeviceSyncPurgeConfirmation";

function ConfirmationHarness() {
  const [open, setOpen] = useState(false);

  return (
    <>
      <button type="button" onClick={() => setOpen(true)}>Delete synced data</button>
      {open ? (
        <DeviceSyncPurgeConfirmation
          onCancel={() => setOpen(false)}
          onConfirm={() => setOpen(false)}
        />
      ) : null}
    </>
  );
}

describe("DeviceSyncPurgeConfirmation", () => {
  it("uses the shared destructive modal hierarchy", () => {
    const onConfirm = vi.fn();
    render(<DeviceSyncPurgeConfirmation onCancel={vi.fn()} onConfirm={onConfirm} />);

    const dialog = screen.getByRole("alertdialog", { name: "Delete synced cloud data?" });
    expect(dialog.getAttribute("aria-describedby")).toBe("device-sync-purge-description");
    expect(screen.getByText(/pauses uploads from every connected device/i)).toBeTruthy();
    expect(screen.getByText(/explicitly turn it on again/i)).toBeTruthy();
    expect(screen.getByRole("button", { name: "Cancel" }).classList.contains("modal-btn--ghost")).toBe(true);
    expect(screen.getByRole("button", { name: "Delete cloud copy" }).classList.contains("modal-btn--danger")).toBe(true);

    fireEvent.click(screen.getByRole("button", { name: "Delete cloud copy" }));
    expect(onConfirm).toHaveBeenCalledTimes(1);
  });

  it("moves focus inside, traps Tab, closes on Escape, and restores opener focus", async () => {
    render(<ConfirmationHarness />);

    const opener = screen.getByRole("button", { name: "Delete synced data" });
    opener.focus();
    fireEvent.click(opener);

    const dialog = screen.getByRole("alertdialog", { name: "Delete synced cloud data?" });
    const cancel = screen.getByRole("button", { name: "Cancel" });
    const confirm = screen.getByRole("button", { name: "Delete cloud copy" });
    await waitFor(() => expect(document.activeElement).toBe(cancel));

    confirm.focus();
    fireEvent.keyDown(dialog, { key: "Tab" });
    expect(document.activeElement).toBe(cancel);

    fireEvent.keyDown(dialog, { key: "Tab", shiftKey: true });
    expect(document.activeElement).toBe(confirm);

    fireEvent.keyDown(window, { key: "Escape" });
    await waitFor(() => expect(screen.queryByRole("alertdialog")).toBeNull());
    expect(document.activeElement).toBe(opener);
  });
});
