// @vitest-environment jsdom

import { renderHook, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { useBrowserHistoryBootstrap } from "./useBrowserHistoryBootstrap";

const trackerMocks = vi.hoisted(() => ({
  previewBrowserHistoryImport: vi.fn(),
  importBrowserHistory: vi.fn(),
}));

vi.mock("../../lib/api/trackerClient", () => ({ trackerClient: trackerMocks }));

describe("browser history bootstrap and first-day recovery", () => {
  beforeEach(() => {
    trackerMocks.previewBrowserHistoryImport.mockReset();
    trackerMocks.importBrowserHistory.mockReset();
  });

  it.each([0, 1])("retires the import marker only when an empty preview has no read errors (%i)", async (errorCount) => {
    trackerMocks.previewBrowserHistoryImport.mockResolvedValue({
      lookbackDays: 3,
      candidateCount: 0,
      segmentCount: 0,
      estimatedSeconds: 0,
      browserCount: 1,
      profileCount: 1,
      databaseCount: 1,
      errorCount,
    });
    const onHistorySettled = vi.fn();
    const { result } = renderHook(() => useBrowserHistoryBootstrap({
      blocked: false,
      enabled: true,
      isPreviewSurface: false,
      shouldStart: true,
      selectedDayRef: { current: "2026-09-24" },
      clearLocalActivityCaches: vi.fn(),
      onHistorySettled,
      refresh: vi.fn().mockResolvedValue(true),
      refreshHistoryData: vi.fn().mockResolvedValue(true),
      setError: vi.fn(),
    }));
    await waitFor(() => expect(result.current.notice?.tone).toBe("neutral"));
    expect(onHistorySettled).toHaveBeenCalledTimes(errorCount === 0 ? 1 : 0);
    expect(trackerMocks.importBrowserHistory).not.toHaveBeenCalled();
  });

  it.each([0, 1])("keeps a partially imported history pending when the import reports read errors (%i)", async (errorCount) => {
    const preview = {
      lookbackDays: 3,
      candidateCount: 1,
      segmentCount: 1,
      estimatedSeconds: 1,
      browserCount: 1,
      profileCount: 1,
      databaseCount: 1,
      errorCount: 0,
    };
    trackerMocks.previewBrowserHistoryImport.mockResolvedValue(preview);
    trackerMocks.importBrowserHistory.mockResolvedValue({ ...preview, insertedCount: 1, skippedDuplicateCount: 0, errorCount });
    const onHistorySettled = vi.fn();
    const { result } = renderHook(() => useBrowserHistoryBootstrap({
      blocked: false,
      enabled: true,
      isPreviewSurface: false,
      shouldStart: true,
      selectedDayRef: { current: "2026-09-24" },
      clearLocalActivityCaches: vi.fn(),
      onHistorySettled,
      refresh: vi.fn().mockResolvedValue(true),
      refreshHistoryData: vi.fn().mockResolvedValue(true),
      setError: vi.fn(),
    }));
    await waitFor(() => expect(result.current.notice?.tone).toBe("success"));
    expect(onHistorySettled).toHaveBeenCalledTimes(errorCount === 0 ? 1 : 0);
  });
});
