// @vitest-environment jsdom
import { act, cleanup, renderHook, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { CurrentActivitySnapshot } from "@drifty/domain";
import { useLiveTrackingPreview } from "./useLiveTrackingPreview";

const { getCurrentSnapshot } = vi.hoisted(() => ({
  getCurrentSnapshot: vi.fn(),
}));

vi.mock("../../lib/api/trackerClient", () => ({
  trackerClient: { getCurrentSnapshot },
}));

afterEach(() => {
  cleanup();
  vi.useRealTimers();
  vi.clearAllMocks();
});

beforeEach(() => {
  getCurrentSnapshot.mockReset();
});

function snapshot(
  appName: string,
  frontmostCaptureSource: CurrentActivitySnapshot["frontmostCaptureSource"] = "system-events",
): CurrentActivitySnapshot {
  return {
    observedAt: "2026-09-08T00:00:00.000Z",
    appName,
    source: "nsworkspace",
    frontmostCaptureSource,
  };
}

async function renderActivePreview() {
  const view = renderHook(({ active }: { active: boolean }) => useLiveTrackingPreview(active), {
    initialProps: { active: true },
  });
  await waitFor(() => expect(getCurrentSnapshot).toHaveBeenCalled());
  return view;
}

describe("useLiveTrackingPreview", () => {
  it.each([null, snapshot(""), snapshot("   ")])("does not claim initial proof without an app name: %j", async (value) => {
    getCurrentSnapshot.mockResolvedValue(value);
    const { result } = await renderActivePreview();
    expect(result.current).toBeNull();
  });

  it("trusts an explicit capture failure over a plausible app name", async () => {
    getCurrentSnapshot.mockResolvedValue(snapshot("Safari", "unavailable"));
    const { result } = await renderActivePreview();
    expect(result.current).toBeNull();
  });

  it("allows a real app named Unavailable when capture explicitly succeeded", async () => {
    getCurrentSnapshot.mockResolvedValue(snapshot("Unavailable", "lsappinfo"));
    const { result } = await renderActivePreview();
    expect(result.current).toEqual({ kind: "current", appName: "Unavailable" });
  });

  it("does not treat an unavailable capture as live proof", async () => {
    getCurrentSnapshot.mockResolvedValue(snapshot("Unavailable", "unavailable"));

    const { result } = await renderActivePreview();

    expect(result.current).toBeNull();
  });

  it("treats the Unavailable appName sentinel as unavailable when source is omitted", async () => {
    getCurrentSnapshot.mockResolvedValue({
      observedAt: "2026-09-08T00:00:00.000Z",
      appName: "Unavailable",
      source: "nsworkspace",
    });

    const { result } = await renderActivePreview();

    expect(result.current).toBeNull();
  });

  it("does not keep a stale recent app after capture becomes unavailable", async () => {
    vi.useFakeTimers();
    getCurrentSnapshot
      .mockResolvedValueOnce(snapshot("Safari"))
      .mockResolvedValueOnce(snapshot("Unavailable", "unavailable"));

    const { result } = renderHook(() => useLiveTrackingPreview(true));
    await act(async () => {
      await Promise.resolve();
    });
    expect(result.current).toEqual({ kind: "current", appName: "Safari" });

    await act(async () => {
      vi.advanceTimersByTime(3_000);
      await Promise.resolve();
    });
    expect(result.current).toBeNull();
  });

  it("recovers to current proof after unavailable capture starts working", async () => {
    vi.useFakeTimers();
    getCurrentSnapshot
      .mockResolvedValueOnce(snapshot("Unavailable", "unavailable"))
      .mockResolvedValueOnce(snapshot("Safari", "lsappinfo"));

    const { result } = renderHook(() => useLiveTrackingPreview(true));
    await act(async () => {
      await Promise.resolve();
    });
    expect(result.current).toBeNull();

    await act(async () => {
      vi.advanceTimersByTime(3_000);
      await Promise.resolve();
    });
    expect(result.current).toEqual({ kind: "current", appName: "Safari" });
  });

  it("does not restore a pre-unavailable app as recent after recovering onto Drifty", async () => {
    vi.useFakeTimers();
    getCurrentSnapshot
      .mockResolvedValueOnce(snapshot("Safari"))
      .mockResolvedValueOnce(snapshot("Unavailable", "unavailable"))
      .mockResolvedValueOnce(snapshot("Drifty"));

    const { result } = renderHook(() => useLiveTrackingPreview(true));
    await act(async () => {
      await Promise.resolve();
    });
    expect(result.current).toEqual({ kind: "current", appName: "Safari" });

    await act(async () => {
      vi.advanceTimersByTime(3_000);
      await Promise.resolve();
    });
    expect(result.current).toBeNull();

    await act(async () => {
      vi.advanceTimersByTime(3_000);
      await Promise.resolve();
    });
    expect(result.current).toEqual({ kind: "waiting" });
  });

  it("keeps current and recent semantics for a real app then Drifty", async () => {
    vi.useFakeTimers();
    getCurrentSnapshot
      .mockResolvedValueOnce(snapshot("System Settings"))
      .mockResolvedValueOnce(snapshot("Drifty"));

    const { result } = renderHook(() => useLiveTrackingPreview(true));
    await act(async () => {
      await Promise.resolve();
    });
    expect(result.current).toEqual({ kind: "current", appName: "System Settings" });

    await act(async () => {
      vi.advanceTimersByTime(3_000);
      await Promise.resolve();
    });
    expect(result.current).toEqual({ kind: "recent", appName: "System Settings" });
  });

  it("does not apply an in-flight snapshot after becoming inactive", async () => {
    let resolveSnapshot: (value: CurrentActivitySnapshot) => void = () => {};
    getCurrentSnapshot.mockImplementation(
      () => new Promise<CurrentActivitySnapshot>((resolve) => {
        resolveSnapshot = resolve;
      }),
    );

    const { result, rerender } = renderHook(
      ({ active }: { active: boolean }) => useLiveTrackingPreview(active),
      { initialProps: { active: true } },
    );
    expect(getCurrentSnapshot).toHaveBeenCalledTimes(1);

    rerender({ active: false });
    expect(result.current).toBeNull();

    await act(async () => {
      resolveSnapshot(snapshot("Safari"));
    });
    expect(result.current).toBeNull();
  });

  it("does not apply an in-flight snapshot after unmount", async () => {
    let resolveSnapshot: (value: CurrentActivitySnapshot) => void = () => {};
    getCurrentSnapshot.mockImplementation(
      () => new Promise<CurrentActivitySnapshot>((resolve) => {
        resolveSnapshot = resolve;
      }),
    );

    const { result, unmount } = renderHook(() => useLiveTrackingPreview(true));
    unmount();

    await act(async () => {
      resolveSnapshot(snapshot("Safari"));
    });
    expect(result.current).toBeNull();
  });

  it("does not poll while inactive", () => {
    renderHook(() => useLiveTrackingPreview(false));
    expect(getCurrentSnapshot).not.toHaveBeenCalled();
  });
});
