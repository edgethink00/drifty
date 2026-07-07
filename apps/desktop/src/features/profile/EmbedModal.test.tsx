// @vitest-environment jsdom
import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { EmbedModal } from "./ProfileModals";

const PUBLIC_ID = "9f3a1b2c-0000-4d5e-8f6a-1b2c3d4e5f60";

describe("EmbedModal", () => {
  it("renders copy-paste snippets and a badge preview for the public id", () => {
    render(<EmbedModal publicId={PUBLIC_ID} focusSeconds={20 * 3600 + 59 * 60} onClose={() => {}} />);

    expect(screen.getByRole("heading", { name: /share a live badge/i })).toBeTruthy();

    const values = (screen.getAllByRole("textbox") as HTMLInputElement[]).map((input) => input.value);
    expect(values.some((v) => v.includes(`drifty.so/profile/?id=${PUBLIC_ID}`))).toBe(true);
    expect(values.some((v) => v.includes(`badge?id=${PUBLIC_ID}`))).toBe(true);

    const preview = screen.getByAltText("Drifty focus badge preview") as HTMLImageElement;
    expect(preview.getAttribute("src")?.startsWith("data:image/svg+xml")).toBe(true);
  });

  it("hints that the badge fills in once this week has focus", () => {
    render(<EmbedModal publicId={PUBLIC_ID} focusSeconds={null} onClose={() => {}} />);
    expect(screen.getByText(/fills in once this week/i)).toBeTruthy();
  });

  it("copies a snippet to the clipboard and shows feedback", async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.assign(navigator, { clipboard: { writeText } });

    render(<EmbedModal publicId={PUBLIC_ID} focusSeconds={3600} onClose={() => {}} />);
    fireEvent.click(screen.getAllByRole("button", { name: /^copy$/i })[0]);

    expect(writeText).toHaveBeenCalledTimes(1);
    expect(await screen.findByRole("button", { name: /copied/i })).toBeTruthy();
  });

  it("closes when the Close button is pressed", () => {
    const onClose = vi.fn();
    render(<EmbedModal publicId={PUBLIC_ID} focusSeconds={3600} onClose={onClose} />);
    fireEvent.click(screen.getByRole("button", { name: /^close$/i }));
    expect(onClose).toHaveBeenCalledTimes(1);
  });
});
