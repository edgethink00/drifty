// @vitest-environment jsdom

import { act, cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { READ_FIRST, UNLOCK_LOCKED, UNLOCK_READY } from "./readFixtures";
import { READ_WRITE_STEPS, READ_WRITE_STEP_MS, REVEAL_MS, ReadWait, type WaitPhase } from "./ReadWait";

afterEach(cleanup);

function renderWait(phase: WaitPhase) {
  return render(
    <ReadWait
      phase={phase}
      progress={phase === "locked" ? UNLOCK_LOCKED : UNLOCK_READY}
      firstRead={READ_FIRST}
      holdWriting
      silhouette={<button type="button">Behind</button>}
      onWrite={() => undefined}
      onSetUpAi={() => undefined}
    />,
  );
}

describe("ReadWait", () => {
  // Product decision 2026-10-05: the unlock notification is on by default, so
  // the waiting dialog asks nothing of the user until the first read can be written.
  it("asks nothing while locked", () => {
    renderWait("locked");
    expect(screen.queryByRole("switch")).toBeNull();
    expect(screen.queryAllByRole("button")).toEqual([]);
  });

  it("asks nothing while writing", () => {
    renderWait("writing");
    expect(screen.queryAllByRole("button")).toEqual([]);
  });

  it("offers exactly one action once ready", () => {
    renderWait("ready");
    expect(screen.getAllByRole("button").map((button) => button.textContent)).toEqual(["Write my first read"]);
  });

  it("offers AI setup as the one action without AI", () => {
    renderWait("ready-no-ai");
    expect(screen.getAllByRole("button").map((button) => button.textContent)).toEqual(["Set up AI"]);
  });

  // Once the first read is written the cover clears in place (the dialog lifts, the read behind sharpens), and only
  // then does the read page take over, so the hand-over moves nothing on screen.
  it("clears the cover in place once written, then hands over to the read", () => {
    vi.useFakeTimers();
    try {
      const written = vi.fn();
      const { container } = render(
        <ReadWait phase="writing" progress={UNLOCK_READY} firstRead={READ_FIRST} silhouette={<p>Behind</p>} onWrite={() => undefined} onSetUpAi={() => undefined} onWritten={written} />,
      );
      const frame = () => container.querySelector(".rw")!;
      for (let step = 0; step < READ_WRITE_STEPS - 1; step += 1) act(() => { vi.advanceTimersByTime(READ_WRITE_STEP_MS); });
      expect(frame().classList.contains("is-open")).toBe(false);
      act(() => { vi.advanceTimersByTime(READ_WRITE_STEP_MS); });
      expect(frame().classList.contains("is-open")).toBe(true);
      expect(written).not.toHaveBeenCalled();
      act(() => { vi.advanceTimersByTime(REVEAL_MS); });
      expect(written).toHaveBeenCalledTimes(1);
    } finally {
      vi.useRealTimers();
    }
  });

  it("keeps the read behind the dialog out of reach", () => {
    const { container } = renderWait("locked");
    const behind = container.querySelector(".rw__behind");
    expect(behind?.getAttribute("aria-hidden")).toBe("true");
    expect(behind?.hasAttribute("inert")).toBe(true);
  });
});
