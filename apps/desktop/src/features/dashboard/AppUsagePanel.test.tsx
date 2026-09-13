// @vitest-environment jsdom
import { render, screen, within } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { AppUsagePanel } from "./AppUsagePanel";
import { SiteIconProvider } from "../../components/SiteIconContext";
import { LocalizationTestProvider } from "../localization/LocalizationContext";

describe("AppUsagePanel", () => {
  it("renders ranked app usage details", () => {
    render(
      <AppUsagePanel
        periodLabel="today"
        totalSeconds={7200}
        appIcons={{ "com.example.code": "data:image/png;base64,abc" }}
        items={[
          {
            rank: 1,
            appName: "Code",
            bundleId: "com.example.code",
            usageKind: "app",
            siteDomain: null,
            siteTitle: null,
            browserName: null,
            totalSeconds: 5400,
            sessionCount: 3,
            activeDays: 1,
            averageSessionSeconds: 1800,
            shareOfTotal: 0.75,
            firstStartedAt: "2026-04-06T09:00:00.000Z",
            lastEndedAt: "2026-04-06T11:00:00.000Z",
          },
          {
            rank: 2,
            appName: "Notes",
            bundleId: null,
            usageKind: "app",
            siteDomain: null,
            siteTitle: null,
            browserName: null,
            totalSeconds: 1800,
            sessionCount: 1,
            activeDays: 1,
            averageSessionSeconds: 1800,
            shareOfTotal: 0.25,
            firstStartedAt: "2026-04-06T11:00:00.000Z",
            lastEndedAt: "2026-04-06T11:30:00.000Z",
          },
        ]}
      />,
    );

    expect(screen.queryByRole("heading", { name: "Attention ledger" })).toBeNull();
    expect(screen.queryByText("app usage · today")).toBeNull();
    expect(screen.queryByLabelText("2 ranked apps, 2h total tracked time")).toBeNull();
    expect(screen.getByText("Most used app")).toBeTruthy();
    expect(screen.getByLabelText("Most used app: Code")).toBeTruthy();

    const code = within(screen.getByLabelText("Most used app: Code"));
    expect(code.getByText("#1")).toBeTruthy();
    expect(code.getByText("1h 30m")).toBeTruthy();
    expect(code.queryByText("75% tracked")).toBeNull();
    expect(code.getByText("75%")).toBeTruthy();
    expect(code.getByText("Sessions")).toBeTruthy();
    expect(code.getByText("3")).toBeTruthy();
    expect(code.getByText("Average")).toBeTruthy();
    expect(code.getByText("30m")).toBeTruthy();

    const notesRow = screen.getByText("Notes").closest("li");
    expect(notesRow).toBeTruthy();
    const notes = within(notesRow as HTMLElement);
    expect(notes.getByText("02")).toBeTruthy();
    expect(notes.getByText("30m")).toBeTruthy();
    expect(notes.getByText("25% · 1 session · 30m avg")).toBeTruthy();
    expect(document.querySelector(".app-usage-panel")?.classList.contains("app-usage-panel--short-compact")).toBe(true);
  });

  it("renders an empty state when no app usage is available", () => {
    render(<AppUsagePanel periodLabel="week" totalSeconds={0} appIcons={{}} items={[]} emptyDetail="No tracked apps this week." />);

    expect(screen.getByText("No usage ranking")).toBeTruthy();
    expect(screen.getByText("Usage is still quiet")).toBeTruthy();
    expect(screen.getByText("No tracked apps this week.")).toBeTruthy();
  });

  it("renders a quiet blank frame when replay asks for empty data instead of empty-state copy", () => {
    render(<AppUsagePanel periodLabel="today" totalSeconds={0} appIcons={{}} items={[]} emptyPresentation="blank" />);

    expect(screen.getByLabelText("No app usage for today yet")).toBeTruthy();
    expect(screen.queryByText("No usage ranking")).toBeNull();
    expect(screen.queryByText("Usage is still quiet")).toBeNull();
  });

  it("renders site usage with browser context", () => {
    render(
      <SiteIconProvider value={{ "github.com": "data:image/png;base64,github" }}>
        <AppUsagePanel
          periodLabel="today"
          totalSeconds={3600}
          appIcons={{ "com.google.Chrome": "data:image/png;base64,chrome" }}
          items={[
            {
              rank: 1,
              appName: "github.com",
              bundleId: null,
              usageKind: "site",
              siteDomain: "github.com",
              siteTitle: "GitHub",
              browserName: "Chrome",
              totalSeconds: 2400,
              sessionCount: 2,
              activeDays: 1,
              averageSessionSeconds: 1200,
              shareOfTotal: 2 / 3,
              firstStartedAt: "2026-04-06T09:00:00.000Z",
              lastEndedAt: "2026-04-06T10:00:00.000Z",
            },
          ]}
        />
      </SiteIconProvider>,
    );

    expect(screen.getByText("Most used site")).toBeTruthy();
    expect(screen.getByLabelText("Most used site: github.com")).toBeTruthy();
    expect(screen.getByText("github.com")).toBeTruthy();
    expect(screen.getByText(/GitHub · via Chrome · Last used/)).toBeTruthy();
    expect(screen.getByRole("presentation").getAttribute("src")).toBe("data:image/png;base64,github");
  });

  it("uses natural Korean usage grammar and locale formatting", () => {
    render(
      <LocalizationTestProvider language="ko">
        <AppUsagePanel
          periodLabel="today"
          totalSeconds={7200}
          appIcons={{}}
          items={[{
            rank: 1,
            appName: "Code",
            bundleId: "com.example.code",
            usageKind: "app",
            siteDomain: null,
            siteTitle: null,
            browserName: null,
            totalSeconds: 5400,
            sessionCount: 3,
            activeDays: 1,
            averageSessionSeconds: 1800,
            shareOfTotal: 0.75,
            firstStartedAt: "2026-04-06T09:00:00.000Z",
            lastEndedAt: "2026-04-06T11:00:00.000Z",
          }]}
        />
      </LocalizationTestProvider>,
    );

    const card = screen.getByLabelText("가장 많이 사용한 앱: Code");
    expect(within(card).getByLabelText("1위")).toBeTruthy();
    expect(within(card).getByText("가장 많이 사용한 앱")).toBeTruthy();
    expect(within(card).getByText("1시간 30분")).toBeTruthy();
    expect(within(card).getByText("비중")).toBeTruthy();
    expect(within(card).getByText("세션")).toBeTruthy();
    expect(within(card).getByText("평균")).toBeTruthy();
    expect(within(card).getByText("사용일")).toBeTruthy();
  });
});
