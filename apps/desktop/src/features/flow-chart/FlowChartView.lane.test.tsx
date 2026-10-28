// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import type { ActivityCategory, ActivitySegment, FlowBlock, ProductivityLabel } from "@drifty/domain";
import { useEffect } from "react";
import { FlowChartView } from "./FlowChartView";
import { ActivityInspectionProvider, useActivityInspection } from "../dashboard/ActivityInspectionContext";
import type { WeekCalendarEvent } from "../dashboard/weekCalendar";

afterEach(cleanup);

const DAY = "2026-04-06";
const segment = (id: string, from: string, to: string, appName: string, category: ActivityCategory, productivity: ProductivityLabel): ActivitySegment => ({
  id, startedAt: DAY + "T" + from + ":00", endedAt: DAY + "T" + to + ":00",
  durationSeconds: (Date.parse(DAY + "T" + to + ":00") - Date.parse(DAY + "T" + from + ":00")) / 1000,
  appName, platform: "macos", source: "nsworkspace",
  classification: { category, productivity, source: "manual", confidence: 1 },
} as ActivitySegment);
const segments = [
  segment("seg-a", "14:00", "14:04", "Code", "workspace", "focus"),
  segment("seg-b", "14:04", "14:08", "Arc", "entertainment", "drift"),
  segment("seg-c", "14:08", "14:12", "Code", "workspace", "focus"),
];
const block = (id: string, minute: number, appName: string, category: FlowBlock["category"], productivity: FlowBlock["productivity"]): FlowBlock => ({
  id: "flow-" + id, day: DAY, hour: 14, quarter: 0, minuteOfDay: minute, appName, category, productivity,
  colorKey: appName, durationSeconds: 240, sourceSegmentIds: [id],
} as FlowBlock);
const blocks = [block("seg-a", 840, "Code", "workspace", "focus"), block("seg-b", 844, "Arc", "entertainment", "drift"), block("seg-c", 848, "Code", "workspace", "focus")];
const card = {
  id: "card-1", segmentIds: ["seg-a", "seg-b", "seg-c"], appName: "Code, Arc", category: "workspace", productivity: "focus",
  startLabel: "", endLabel: "", detailSummary: "", detailTitle: "", sessionCount: 3, identities: [], hiddenIdentityCount: 0,
  isGroupedCluster: true, hasMixedCategory: true, hasMixedProductivity: true, classificationSource: "manual", aiClassification: false,
  topMinutes: 840, durationMinutes: 12, activeDurationMinutes: 12, isShort: true, lane: 0, laneCount: 1,
} as unknown as WeekCalendarEvent;

function LaneClick({ withLane }: { readonly withLane: boolean }) {
  const inspection = useActivityInspection();
  useEffect(() => {
    if (!withLane) return;
    inspection.laneSelection.current = { label: null, stretch: { startMs: 0, endMs: 0, segmentIds: card.segmentIds }, atMs: Date.now(), event: card, projectBySegmentId: new Map() };
  }, [inspection, withLane]);
  return null;
}

function renderChart(withLane: boolean) {
  render(
    <ActivityInspectionProvider scopeKey="test" onRequestOpen={() => {}}>
      <LaneClick withLane={withLane} />
      <FlowChartView blocks={blocks} appIcons={{}} intervalMinutes={4} activityActionsEnabled segments={segments} />
    </ActivityInspectionProvider>,
  );
  fireEvent.click(screen.getByRole("button", { name: /time block: 14:00–14:04/i }));
}

describe("a Day activity card opens as itself", () => {
  it("edits and deletes every record of the clicked card, marking its mixed values", () => {
    renderChart(true);
    const inspector = screen.getByRole("dialog");
    expect(within(inspector).getByRole("button", { name: "Delete 3 activities…" })).toBeTruthy();
    expect(within(inspector).getAllByText("+ more").length).toBeGreaterThanOrEqual(2);
  });

  it("keeps a chart cell's own run when no card opened it", () => {
    renderChart(false);
    const inspector = screen.getByRole("dialog");
    expect(within(inspector).getByRole("button", { name: "Delete activity…" })).toBeTruthy();
    expect(within(inspector).queryByText("+ more")).toBeNull();
  });
});

