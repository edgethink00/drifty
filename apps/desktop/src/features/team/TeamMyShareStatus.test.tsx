// @vitest-environment jsdom
import { act, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { LocalizationTestProvider } from "../localization/LocalizationContext";
import { TeamMyShareStatus } from "./TeamMyShareStatus";
import { readTeamShareStatus, recordTeamShareResult } from "./teamShareStatus";

afterEach(() => {
  window.localStorage.clear();
  vi.restoreAllMocks();
});

const view = (hoursTimeZone: string | null = "Asia/Seoul") => (
  <LocalizationTestProvider language="en">
    <TeamMyShareStatus accountKey="u1" organizationId="org-1" hoursTimeZone={hoursTimeZone} />
  </LocalizationTestProvider>
);

describe("my sharing status", () => {
  it("keeps the last shared time and total through a later failed pass, per account and team", () => {
    recordTeamShareResult("u1", "org-1", { status: "shared", projectDays: 2, focusDays: 2, workBlocks: 4, recentSeconds: 7200 }, new Date("2026-11-08T01:00:00Z"));
    recordTeamShareResult("u1", "org-1", { status: "failed", error: "offline" }, new Date("2026-11-08T01:30:00Z"));
    expect(readTeamShareStatus("u1", "org-1")).toEqual({
      checkedAt: "2026-11-08T01:30:00.000Z", outcome: "failed", reason: null, error: "offline",
      sharedAt: "2026-11-08T01:00:00.000Z", recentSeconds: 7200,
    });
    expect(readTeamShareStatus("u2", "org-1")).toBeNull();
    expect(readTeamShareStatus("u1", "org-2")).toBeNull();
  });

  it("says when nothing has gone up yet, then shows the last share and the week's total", () => {
    render(view());
    expect(screen.getByText("Not yet")).toBeTruthy();
    expect(screen.getByText(/shares every 30 minutes inside team hours/)).toBeTruthy();
    act(() => { recordTeamShareResult("u1", "org-1", { status: "shared", projectDays: 1, focusDays: 1, workBlocks: 2, recentSeconds: 3 * 3600 + 15 * 60 }); });
    expect(screen.getByText("just now")).toBeTruthy();
    expect(screen.getByText(/3h 15m|3h15m|3 h 15 m/)).toBeTruthy();
    expect(screen.queryByText(/shares every 30 minutes/)).toBeNull();
  });

  it("names why the latest pass sent nothing or failed", () => {
    recordTeamShareResult("u1", "org-1", { status: "nothing", reason: "outside-hours" });
    const { rerender } = render(view());
    expect(screen.getByText("None of your time since joining falls inside team hours yet.")).toBeTruthy();
    act(() => { recordTeamShareResult("u1", "org-1", { status: "failed", error: "Network request failed" }); });
    rerender(view());
    expect(screen.getByText(/didn't go through.*Network request failed/)).toBeTruthy();
  });

  it("warns when the team's hours are stored in UTC and this computer is elsewhere", () => {
    vi.spyOn(Intl.DateTimeFormat.prototype, "resolvedOptions").mockReturnValue({ timeZone: "Asia/Seoul" } as Intl.ResolvedDateTimeFormatOptions);
    const { rerender } = render(view("UTC"));
    expect(screen.getByText(/saved in UTC.*Asia\/Seoul/)).toBeTruthy();
    rerender(view("Asia/Seoul"));
    expect(screen.queryByText(/saved in UTC/)).toBeNull();
  });
});
