// @vitest-environment jsdom
import { cleanup, render } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { LocalizationTestProvider } from "../localization/LocalizationContext";
import { YourDayUsageSummary } from "./YourDayUsageSummary";

afterEach(cleanup);

describe("Day Breakdown apps list", () => {
  it("reads an app used under a minute in seconds, never 0m", () => {
    const items = [
      { rank: 1, appName: "Safari", bundleId: null, usageKind: "site", siteDomain: "example.com", totalSeconds: 3000 },
      { rank: 2, appName: "Notes", bundleId: null, usageKind: "app", siteDomain: null, totalSeconds: 25 },
    ] as unknown as Parameters<typeof YourDayUsageSummary>[0]["items"];
    const { container } = render(<LocalizationTestProvider language="en"><YourDayUsageSummary items={items} appIcons={{}} totalSeconds={3025} /></LocalizationTestProvider>);
    expect([...container.querySelectorAll(".your-day-usage__duration")].map((cell) => cell.textContent)).toEqual(["50m", "25s"]);
  });
});

