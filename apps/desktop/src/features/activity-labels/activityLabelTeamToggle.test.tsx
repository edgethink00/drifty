// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";

import { LocalizationTestProvider } from "../localization/LocalizationContext";
import { TeamBlockExclusionContext, readTeamExcludedRanges } from "../team/teamBlockExclusions";
import { ActivityLabelRow } from "./ActivityLabelCard";
import type { ActivityInspectorLabel } from "./activityInspectorLabel";

afterEach(() => {
  cleanup();
  window.localStorage.clear();
});

const start = Date.parse("2026-11-08T01:00:00Z");
const unnamed = {
  block: { key: "b", day: "2026-11-08", startMs: start, endMs: start + 3_600_000, startMinute: 600, endMinute: 660, segmentIds: ["s"], recordedSeconds: 3600, resolution: { kind: "none", needsGeneration: false }, display: null, card: null, otherCards: [], generation: "resolved" },
  display: null,
  scope: "block",
} as unknown as ActivityInspectorLabel;

const view = (teams: boolean, editable = true) => (
  <LocalizationTestProvider language="en">
    <TeamBlockExclusionContext.Provider value={teams}>
      <ActivityLabelRow label={unnamed} editable={editable} />
    </TeamBlockExclusionContext.Provider>
  </LocalizationTestProvider>
);

describe("keeping a block from the team", () => {
  it("is offered on a block without a name, so people without AI names can use it", () => {
    render(view(true));
    fireEvent.click(screen.getByRole("button", { name: "Don't share with team" }));
    expect(readTeamExcludedRanges()).toEqual([{ start, end: start + 3_600_000 }]);
    expect(screen.getByText("Not shared with your team")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Share with team again" }));
    expect(readTeamExcludedRanges()).toEqual([]);
  });

  it("is not offered outside the Teams beta or on a read-only row", () => {
    const { rerender } = render(view(false));
    expect(screen.queryByRole("button", { name: "Don't share with team" })).toBeNull();
    rerender(view(true, false));
    expect(screen.queryByRole("button", { name: "Don't share with team" })).toBeNull();
  });
});
