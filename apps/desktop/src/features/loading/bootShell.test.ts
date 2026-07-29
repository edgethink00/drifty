// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  BOOT_SHELL_PREVIEW_DURATION_MS,
  hideBootShell,
  showBootShellPreview,
} from "./bootShell";

describe("boot shell preview", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    document.body.innerHTML = `
      <div id="boot-shell" hidden aria-hidden="true" data-boot-preview="false">
        <span id="boot-status">drifty still loading…</span>
      </div>
    `;
  });

  afterEach(() => {
    hideBootShell();
    document.body.replaceChildren();
    vi.useRealTimers();
  });

  it("shows the real boot shell for exactly three seconds and resets its copy", () => {
    expect(showBootShellPreview()).toBe(true);

    const shell = document.getElementById("boot-shell");
    expect(shell?.hidden).toBe(false);
    expect(shell?.getAttribute("aria-hidden")).toBeNull();
    expect(shell?.dataset.bootPreview).toBe("true");
    expect(document.documentElement.dataset.bootActive).toBe("true");
    expect(document.getElementById("boot-status")?.textContent).toBe("drifty loading…");

    vi.advanceTimersByTime(BOOT_SHELL_PREVIEW_DURATION_MS - 1);
    expect(shell?.hidden).toBe(false);

    vi.advanceTimersByTime(1);
    expect(shell?.hidden).toBe(true);
    expect(shell?.getAttribute("aria-hidden")).toBe("true");
    expect(shell?.dataset.bootPreview).toBeUndefined();
    expect(document.documentElement.dataset.bootActive).toBeUndefined();
  });

  it("restarts the three-second window when preview is requested again", () => {
    showBootShellPreview();
    vi.advanceTimersByTime(2_000);
    showBootShellPreview();
    vi.advanceTimersByTime(2_000);

    expect(document.getElementById("boot-shell")?.hidden).toBe(false);

    vi.advanceTimersByTime(1_000);
    expect(document.getElementById("boot-shell")?.hidden).toBe(true);
  });

  it("does nothing when the boot shell is unavailable", () => {
    document.body.replaceChildren();

    expect(showBootShellPreview()).toBe(false);
  });
});
