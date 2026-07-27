// @vitest-environment jsdom

import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { useState } from "react";
import { describe, expect, it, vi } from "vitest";

import { ProjectPassConsentModal, type ProjectPassConsentModalProps } from "./ProjectPassConsentModal";

function baseProps(overrides: Partial<ProjectPassConsentModalProps> = {}): ProjectPassConsentModalProps {
  return {
    open: true,
    providerLabel: "OpenRouter (GPT-5 mini)",
    includesSiteUrl: true,
    includesWindowTitles: true,
    includesContentContext: true,
    storesCloudSamples: false,
    onConfirm: vi.fn(),
    onCancel: vi.fn(),
    ...overrides,
  };
}

function ProjectPassConsentModalHarness() {
  const [open, setOpen] = useState(false);

  return (
    <>
      <button type="button" onClick={() => setOpen(true)}>Analyze last 7 days</button>
      <ProjectPassConsentModal
        {...baseProps({
          open,
          onCancel: () => setOpen(false),
        })}
      />
    </>
  );
}

describe("ProjectPassConsentModal", () => {
  it("renders nothing when closed", () => {
    const { container } = render(<ProjectPassConsentModal {...baseProps({ open: false })} />);

    expect(container.firstChild).toBeNull();
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  it("shows the provider and the transmission scope when open", () => {
    render(<ProjectPassConsentModal {...baseProps()} />);

    expect(screen.getByRole("dialog", { name: /Turn on project analysis/i })).toBeTruthy();
    expect(screen.getByText("OpenRouter (GPT-5 mini)")).toBeTruthy();
    expect(screen.getByText(/Each 3-minute activity window is classified independently/i)).toBeTruthy();
    expect(screen.getByText(/work profile/i)).toBeTruthy();
    expect(screen.getByText(/never sends your raw history/i)).toBeTruthy();
  });

  it("shows the exact optional context enabled by the privacy controls", () => {
    render(<ProjectPassConsentModal {...baseProps({ includesWindowTitles: false })} />);

    const contextLine = screen.getByText(/Optional context currently included/i);
    expect(contextLine.textContent).toContain("page URL path");
    expect(contextLine.textContent).toContain("page/video title");
    expect(contextLine.textContent).not.toContain("window title");
  });

  it("discloses minimized cloud sample storage only for the cloud route", () => {
    const { rerender } = render(<ProjectPassConsentModal {...baseProps({ storesCloudSamples: false })} />);
    expect(screen.queryByText(/sample may be stored/i)).toBeNull();

    rerender(<ProjectPassConsentModal {...baseProps({ storesCloudSamples: true })} />);
    expect(screen.getByText(/sample may be stored/i)).toBeTruthy();
  });

  it("calls onConfirm when Turn on is clicked", () => {
    const onConfirm = vi.fn();
    const onCancel = vi.fn();
    render(<ProjectPassConsentModal {...baseProps({ onConfirm, onCancel })} />);

    fireEvent.click(screen.getByRole("button", { name: /^Turn on$/i }));

    expect(onConfirm).toHaveBeenCalledTimes(1);
    expect(onCancel).not.toHaveBeenCalled();
  });

  it("calls onCancel when Cancel is clicked", () => {
    const onConfirm = vi.fn();
    const onCancel = vi.fn();
    render(<ProjectPassConsentModal {...baseProps({ onConfirm, onCancel })} />);

    fireEvent.click(screen.getByRole("button", { name: /^Cancel$/i }));

    expect(onCancel).toHaveBeenCalledTimes(1);
    expect(onConfirm).not.toHaveBeenCalled();
  });

  it("moves focus inside, contains Tab, closes on Escape, and restores opener focus", async () => {
    render(<ProjectPassConsentModalHarness />);

    const opener = screen.getByRole("button", { name: "Analyze last 7 days" });
    opener.focus();
    fireEvent.click(opener);

    const dialog = screen.getByRole("dialog", { name: "Turn on project analysis" });
    const closeButton = screen.getByRole("button", { name: "Close" });
    const cancelButton = screen.getByRole("button", { name: "Cancel" });
    const confirmButton = screen.getByRole("button", { name: "Turn on" });

    await waitFor(() => expect(document.activeElement).toBe(cancelButton));
    expect(dialog.contains(document.activeElement)).toBe(true);

    confirmButton.focus();
    fireEvent.keyDown(confirmButton, { key: "Tab" });
    expect(document.activeElement).toBe(closeButton);

    closeButton.focus();
    fireEvent.keyDown(closeButton, { key: "Tab", shiftKey: true });
    expect(document.activeElement).toBe(confirmButton);

    fireEvent.keyDown(window, { key: "Escape" });
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    expect(document.activeElement).toBe(opener);
  });
});
