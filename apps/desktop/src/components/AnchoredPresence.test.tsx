// @vitest-environment jsdom
import { useState } from "react";
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { AnchoredPresence } from "./AnchoredPresence";

const tick = (ms: number) => act(() => { vi.advanceTimersByTime(ms); });

function Harness() {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button onClick={() => setOpen((current) => !current)}>Toggle</button>
      <AnchoredPresence>{open ? <div role="menu" aria-label="Options"><button>Rename</button></div> : null}</AnchoredPresence>
    </>
  );
}

beforeEach(() => {
  vi.useFakeTimers();
  vi.stubGlobal("requestAnimationFrame", (callback: FrameRequestCallback) => window.setTimeout(() => callback(0), 16));
  vi.stubGlobal("cancelAnimationFrame", window.clearTimeout);
});
afterEach(() => { cleanup(); vi.useRealTimers(); vi.unstubAllGlobals(); });

describe("AnchoredPresence", () => {
  it("keeps a dismissed menu on screen through its exit, then removes it", () => {
    render(<Harness />);
    fireEvent.click(screen.getByText("Toggle"));
    tick(20);
    const boundary = screen.getByRole("menu").parentElement;
    expect(boundary?.getAttribute("data-anchored-presence")).toBe("open");

    fireEvent.click(screen.getByText("Toggle"));

    expect(screen.queryByRole("menu")).not.toBeNull();
    expect(boundary?.getAttribute("data-anchored-presence")).toBe("exiting");

    tick(300);

    expect(screen.queryByRole("menu")).toBeNull();
  });

  it("takes a closing menu out of the focus and accessibility trees while it fades", () => {
    render(<Harness />);
    fireEvent.click(screen.getByText("Toggle"));
    tick(20);
    const boundary = screen.getByRole("menu").parentElement as HTMLElement;
    expect(boundary.inert).toBe(false);

    fireEvent.click(screen.getByText("Toggle"));

    // Still painted, no longer reachable: a fading menu must not take a click
    // or be announced as if it were open.
    expect(boundary.inert).toBe(true);
  });

  it("removes a menu dismissed before its first frame without retaining a pose", () => {
    render(<Harness />);
    fireEvent.click(screen.getByText("Toggle"));
    fireEvent.click(screen.getByText("Toggle"));

    expect(screen.queryByRole("menu")).toBeNull();
  });

  it("closes immediately when reduced motion is requested", () => {
    vi.stubGlobal("matchMedia", () => ({ matches: true, addEventListener: vi.fn(), removeEventListener: vi.fn() }));
    render(<Harness />);
    fireEvent.click(screen.getByText("Toggle"));
    tick(20);
    fireEvent.click(screen.getByText("Toggle"));

    expect(screen.queryByRole("menu")).toBeNull();
  });
});
