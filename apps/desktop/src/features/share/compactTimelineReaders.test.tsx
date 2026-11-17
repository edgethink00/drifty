// @vitest-environment jsdom
import { act, cleanup, renderHook, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import type { ActivitySegment } from "@drifty/domain";
import { buildFocusCardPayload, buildFocusCardPayloadFromTracker } from "./focusCardPublisher";
import { useDailyProductivitySeries } from "./dailyProductivity";

const { compact, full } = vi.hoisted(() => ({ compact: vi.fn(), full: vi.fn() }));
vi.mock("../../lib/api/trackerClient", () => ({ trackerClient: { getCompactTimeline: compact, getTimeline: full } }));

const day = "2026-11-10";
const local: ActivitySegment = {
  id: "local", startedAt: day + "T09:00:00Z", endedAt: day + "T09:05:00Z", durationSeconds: 300,
  appName: "QA browser", siteDomain: "youtube.com", youtubeVideoId: "synthetic",
  youtubeCategory: "People & Blogs", youtubeDescription: "music", youtubeKeywords: null,
  platform: "windows", source: "accessibility",
  classification: { category: "workspace", productivity: "focus", source: "manual", confidence: 1 },
};

beforeEach(() => { vi.resetAllMocks(); localStorage.clear(); });
afterEach(cleanup);

it("builds the same Focus Card through the compact route and excludes remote data", async () => {
  compact.mockResolvedValueOnce([local, { ...local, id: "remote", deviceId: "qa-remote" }]);
  const input = { windowEndDay: day, startOfDayMinutes: 0, includeAiClassifications: true,
    shareCategoryBreakdown: true, shareHourlyPattern: true };
  expect(await buildFocusCardPayloadFromTracker(input)).toEqual(buildFocusCardPayload([local], input));
  expect(compact).toHaveBeenCalledOnce();
  expect(full).not.toHaveBeenCalled();
});

it("uses the compact route for all-device daily series and counts overlap once", async () => {
  compact.mockResolvedValueOnce([local, { ...local, id: "remote", deviceId: "qa-remote" }]);
  const { result } = renderHook(() => useDailyProductivitySeries({
    windowEndDay: day, startOfDayMinutes: 0, includeAiClassifications: true, enabled: true,
  }));
  await waitFor(() => expect(result.current).not.toBeNull());
  expect(result.current?.find(point => point.day === day)?.focus).toBe(300);
  expect(compact).toHaveBeenCalledOnce();
  expect(full).not.toHaveBeenCalled();
});

it("leaves the series unavailable on read failure instead of manufacturing zeros", async () => {
  compact.mockRejectedValueOnce(new Error("tracker_timeline_too_large"));
  const { result } = renderHook(() => useDailyProductivitySeries({
    windowEndDay: day, startOfDayMinutes: 0, includeAiClassifications: true, enabled: true,
  }));
  await waitFor(() => expect(compact).toHaveBeenCalledOnce());
  await act(async () => { await Promise.resolve(); });
  expect(result.current).toBeNull();
  expect(full).not.toHaveBeenCalled();
});
