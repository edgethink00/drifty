// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ProfileEmbedsModal, type ProfileEmbedsModalProps } from "./ProfileEmbedsModal";

const writeText = vi.fn();
afterEach(() => { cleanup(); vi.useRealTimers(); vi.unstubAllGlobals(); writeText.mockReset(); });

const props: ProfileEmbedsModalProps = {
  card: { enabled: true, busy: false, error: null, detailFlags: null, refresh: vi.fn(), enable: vi.fn(), disable: vi.fn(), setDetailFlag: vi.fn() },
  dailyProductivity: null, displayName: "Alex",
  draft: { displayName: "Alex", bio: "", avatarUrl: "", websiteUrl: "", githubUrl: "", linkedinUrl: "", isPublic: true },
  focusSeconds7d: 7200, isProfilePublic: true, publicId: "review-example",
  onClose: vi.fn(), onEditProfile: vi.fn(),
};
function mount() {
  vi.stubGlobal("navigator", { clipboard: { writeText } });
  return render(<ProfileEmbedsModal {...props} />);
}

describe("ProfileEmbedsModal copy recovery", () => {
  it("starts clipboard access in the click, prevents duplicates, and keeps a failed copy beside its snippet until retry", async () => {
    let reject!: (error: Error) => void;
    writeText.mockImplementationOnce(() => new Promise((_, rejectPromise) => { reject = rejectPromise; })).mockResolvedValue(undefined);
    mount();
    const copies = screen.getAllByRole("button", { name: "Copy" });
    fireEvent.click(copies[0]!);
    expect(writeText).toHaveBeenCalledTimes(1);
    expect(copies[0]).toHaveProperty("disabled", true);
    fireEvent.click(copies[0]!);
    expect(writeText).toHaveBeenCalledTimes(1);
    await act(async () => reject(new Error("clipboard denied")));
    const error = screen.getByRole("alert");
    expect(error.closest(".profile-embed-card__variant")?.textContent).toContain("Markdown");
    vi.useFakeTimers();
    act(() => vi.advanceTimersByTime(10_000));
    expect(screen.getByRole("alert")).toBe(error);
    await act(async () => fireEvent.click(copies[0]!));
    expect(writeText).toHaveBeenCalledTimes(2);
    expect(screen.queryByRole("alert")).toBeNull();
    expect(screen.getByRole("button", { name: "Copied" })).toBeTruthy();
    act(() => vi.advanceTimersByTime(2_000));
    expect(screen.queryByRole("button", { name: "Copied" })).toBeNull();
  });

  it("clears a copy error when the format changes and ignores an old request after target change", async () => {
    writeText.mockRejectedValueOnce(new Error("clipboard denied"));
    mount();
    await act(async () => fireEvent.click(screen.getAllByRole("button", { name: "Copy" })[0]!));
    expect(screen.getByRole("alert")).toBeTruthy();
    fireEvent.click(screen.getByRole("radio", { name: /Data/ }));
    expect(screen.queryByRole("alert")).toBeNull();
    let reject!: (error: Error) => void;
    writeText.mockImplementationOnce(() => new Promise((_, rejectPromise) => { reject = rejectPromise; }));
    fireEvent.click(screen.getAllByRole("button", { name: "Copy" })[0]!);
    fireEvent.click(screen.getByRole("radio", { name: /Card/ }));
    await act(async () => reject(new Error("old request")));
    expect(screen.queryByRole("alert")).toBeNull();
  });

  it("shows public-link failures inside the open embeds dialog", async () => {
    writeText.mockRejectedValueOnce(new Error("clipboard denied"));
    mount();
    await act(async () => fireEvent.click(screen.getByRole("button", { name: "Copy profile link" })));
    expect(screen.getByRole("alert").closest(".embeds-topbar")).toBeTruthy();
    expect(writeText).toHaveBeenCalledWith("https://drifty.so/profile/?id=review-example");
  });
});
