// @vitest-environment jsdom
import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { EmbedModal } from "./ProfileModals";
import type { FocusCardControls } from "../share/useFocusCard";

const PUBLIC_ID = "9f3a1b2c-0000-4d5e-8f6a-1b2c3d4e5f60";

function mockCard(overrides: Partial<FocusCardControls> = {}): FocusCardControls {
  return {
    enabled: false,
    busy: false,
    error: null,
    refresh: vi.fn().mockResolvedValue(undefined),
    enable: vi.fn().mockResolvedValue(true),
    disable: vi.fn().mockResolvedValue(undefined),
    ...overrides,
  };
}

describe("EmbedModal", () => {
  it("renders copy-paste snippets and a badge preview for the public id", () => {
    render(<EmbedModal publicId={PUBLIC_ID} focusSeconds={20 * 3600 + 59 * 60} card={mockCard()} onClose={() => {}} />);

    expect(screen.getByRole("heading", { name: /share a live badge/i })).toBeTruthy();

    const values = (screen.getAllByRole("textbox") as HTMLInputElement[]).map((input) => input.value);
    expect(values.some((v) => v.includes(`drifty.so/profile/?id=${PUBLIC_ID}`))).toBe(true);
    expect(values.some((v) => v.includes(`badge?id=${PUBLIC_ID}`))).toBe(true);

    const preview = screen.getByAltText("Drifty focus badge preview") as HTMLImageElement;
    expect(preview.getAttribute("src")?.startsWith("data:image/svg+xml")).toBe(true);
  });

  it("hints that the badge fills in once this week has focus", () => {
    render(<EmbedModal publicId={PUBLIC_ID} focusSeconds={null} card={mockCard()} onClose={() => {}} />);
    expect(screen.getByText(/fills in once this week/i)).toBeTruthy();
  });

  it("loads the current card state on open and enables the public card", () => {
    const card = mockCard({ enabled: false });
    render(<EmbedModal publicId={PUBLIC_ID} focusSeconds={3600} card={card} onClose={() => {}} />);

    expect(card.refresh).toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: /make public/i }));
    expect(card.enable).toHaveBeenCalledTimes(1);
  });

  it("offers to make the card private when it is already public", () => {
    const card = mockCard({ enabled: true });
    render(<EmbedModal publicId={PUBLIC_ID} focusSeconds={3600} card={card} onClose={() => {}} />);

    fireEvent.click(screen.getByRole("button", { name: /make private/i }));
    expect(card.disable).toHaveBeenCalledTimes(1);
  });

  it("copies a snippet to the clipboard and shows feedback", async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.assign(navigator, { clipboard: { writeText } });

    render(<EmbedModal publicId={PUBLIC_ID} focusSeconds={3600} card={mockCard()} onClose={() => {}} />);
    fireEvent.click(screen.getAllByRole("button", { name: /^copy$/i })[0]);

    expect(writeText).toHaveBeenCalledTimes(1);
    expect(await screen.findByRole("button", { name: /copied/i })).toBeTruthy();
  });

  it("closes when the Close button is pressed", () => {
    const onClose = vi.fn();
    render(<EmbedModal publicId={PUBLIC_ID} focusSeconds={3600} card={mockCard()} onClose={onClose} />);
    fireEvent.click(screen.getByRole("button", { name: /^close$/i }));
    expect(onClose).toHaveBeenCalledTimes(1);
  });
});
