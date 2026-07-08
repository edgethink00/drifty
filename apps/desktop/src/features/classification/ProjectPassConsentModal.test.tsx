// @vitest-environment jsdom

import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { ProjectPassConsentModal, type ProjectPassConsentModalProps } from "./ProjectPassConsentModal";

function baseProps(overrides: Partial<ProjectPassConsentModalProps> = {}): ProjectPassConsentModalProps {
  return {
    open: true,
    providerLabel: "OpenRouter (GPT-5 mini)",
    includesTitles: true,
    onConfirm: vi.fn(),
    onCancel: vi.fn(),
    ...overrides,
  };
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
    expect(screen.getByText(/compacted 3-minute activity-window summary/i)).toBeTruthy();
    expect(screen.getByText(/work profile/i)).toBeTruthy();
    expect(screen.getByText(/never sends your raw history/i)).toBeTruthy();
  });

  it("notes that titles are excluded when content context is off", () => {
    render(<ProjectPassConsentModal {...baseProps({ includesTitles: false })} />);

    expect(screen.getByText(/titles are excluded/i)).toBeTruthy();
  });

  it("omits the titles-excluded note when titles are included", () => {
    render(<ProjectPassConsentModal {...baseProps({ includesTitles: true })} />);

    expect(screen.queryByText(/titles are excluded/i)).toBeNull();
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
});
