// @vitest-environment jsdom
import { act, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { COPY_FEEDBACK_VISIBLE_MS } from "../../lib/useCopyFeedback";
import { LocalizationTestProvider } from "../localization/LocalizationContext";
import { RankEmbedsModal } from "./RankEmbedsModal";

function renderRankEmbedsModal() {
  return render(
    <LocalizationTestProvider language="en">
      <RankEmbedsModal
        avatarUrl=""
        displayName="drifty"
        focusSeconds={52 * 60}
        isProfilePublic
        isRanked
        period="weekly"
        publicId="public-profile-1"
        rank={6}
        onClose={vi.fn()}
      />
    </LocalizationTestProvider>,
  );
}

describe("RankEmbedsModal copy confirmation", () => {
  const writeText = vi.fn<(text: string) => Promise<void>>();

  beforeEach(() => {
    vi.useFakeTimers();
    writeText.mockReset().mockResolvedValue(undefined);
    Object.defineProperty(navigator, "clipboard", { configurable: true, value: { writeText } });
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("keeps the latest Copied for its full window when both snippets are copied back to back", async () => {
    renderRankEmbedsModal();
    const [htmlCopy, markdownCopy] = screen.getAllByRole("button", { name: "Copy" });

    await act(async () => {
      fireEvent.click(htmlCopy);
    });
    expect(htmlCopy.textContent).toBe("Copied");

    await act(async () => {
      vi.advanceTimersByTime(1_200);
    });
    await act(async () => {
      fireEvent.click(markdownCopy);
    });
    expect(writeText).toHaveBeenCalledTimes(2);
    expect(htmlCopy.textContent).toBe("Copy");
    expect(markdownCopy.textContent).toBe("Copied");

    // The HTML copy's window has run out; the newer confirmation must not
    // disappear with it.
    act(() => {
      vi.advanceTimersByTime(COPY_FEEDBACK_VISIBLE_MS - 400);
    });
    expect(markdownCopy.textContent).toBe("Copied");

    act(() => {
      vi.advanceTimersByTime(400);
    });
    expect(markdownCopy.textContent).toBe("Copy");
  });
});
