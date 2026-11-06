// @vitest-environment jsdom
import { fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { LocalizationTestProvider } from "../localization/LocalizationContext";
import { TeamPolicySummary } from "./TeamPolicySummary";
import { TeamSharingWindowEditor } from "./TeamSharingPolicyEditor";
import { computerTimeZone, defaultTeamRecordingSchedule } from "./teamSharingScope";

const weekdays = { days: [1, 2, 3, 4, 5], start_minute: 540, end_minute: 1080 };
const policy = { projects: "member_daily", tasks: "off", focus: "off", memberSummary: true } as const;

afterEach(() => vi.restoreAllMocks());

describe("a team's time zone", () => {
  it("starts a new team's hours on the clock of the computer setting it up", () => {
    vi.spyOn(Intl.DateTimeFormat.prototype, "resolvedOptions").mockReturnValue({ timeZone: "America/New_York" } as Intl.ResolvedDateTimeFormatOptions);
    expect(defaultTeamRecordingSchedule()).toEqual({ ...weekdays, timezone: "America/New_York" });
  });

  it("shows hours stored on another clock and moves them to this computer's", () => {
    const onWindowChange = vi.fn();
    render(<LocalizationTestProvider language="en"><TeamSharingWindowEditor window={{ ...weekdays, timezone: "UTC" }} onWindowChange={onWindowChange} tracking="free" idPrefix="t" /></LocalizationTestProvider>);
    const zone = screen.getByRole("combobox", { name: "Time zone" });
    expect(zone.textContent).toMatch(/Coordinated Universal Time|UTC|GMT/);
    fireEvent.click(zone);
    fireEvent.click(screen.getByRole("option", { name: /Korean|Seoul/ }));
    expect(computerTimeZone()).toBe("Asia/Seoul");
    expect(onWindowChange).toHaveBeenCalledWith({ ...weekdays, timezone: "Asia/Seoul" });
  });

  it("names the hours' clock to someone reading them from another one", () => {
    const { rerender } = render(<LocalizationTestProvider language="en"><TeamPolicySummary policy={policy} window={{ ...weekdays, timezone: "UTC" }} tracking="free" /></LocalizationTestProvider>);
    expect(document.querySelector(".team-policy-summary__notes")!.textContent).toMatch(/Team hours .+ · (Coordinated Universal Time|UTC|GMT)/);
    rerender(<LocalizationTestProvider language="en"><TeamPolicySummary policy={policy} window={{ ...weekdays, timezone: "Asia/Seoul" }} tracking="free" /></LocalizationTestProvider>);
    expect(document.querySelector(".team-policy-summary__notes")!.textContent).not.toMatch(/ · /);
  });
});
