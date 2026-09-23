// @vitest-environment jsdom

import { useState } from "react";
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { LocalizationTestProvider } from "../localization/LocalizationContext";
import { CommandBar } from "./CommandBar";
import { ModalPresence } from "../../components/ModalPresence";

afterEach(() => {
  cleanup();
  vi.unstubAllEnvs();
});

describe("CommandBar", () => {
  it("keeps the legacy command order when the navigation refresh is off", () => {
    render(
      <LocalizationTestProvider language="en">
        <CommandBar includeProjects onDismiss={vi.fn()} onNavigate={vi.fn()} />
      </LocalizationTestProvider>,
    );

    const navigation = screen.getByRole("group", { name: "Navigate" });
    expect(within(navigation).getAllByRole("button").map((button) => button.textContent)).toEqual([
      "DashboardToday at a glance⌘1",
      "ClassificationActivity breakdown⌘2",
      "ProjectsTime grouped by project⌘3",
      "InsightsUsage and focus rhythm⌘4",
      "HistoryLocal records⌘5",
      "SocialGlobal focus leaderboard⌘6",
      "SettingsApp preferences⌘,",
    ]);
    expect(within(navigation).queryByText("Agents")).toBeNull();
  });

  it("hides the macOS shortcut hints on Windows, where no key triggers them", () => {
    vi.stubEnv("VITE_DRIFTY_HOST_PLATFORM", "windows");
    render(
      <LocalizationTestProvider language="en">
        <CommandBar includeProjects onDismiss={vi.fn()} onNavigate={vi.fn()} />
      </LocalizationTestProvider>,
    );

    const navigation = screen.getByRole("group", { name: "Navigate" });
    expect(within(navigation).getAllByRole("button").map((button) => button.textContent)).toEqual([
      "DashboardToday at a glance",
      "ClassificationActivity breakdown",
      "ProjectsTime grouped by project",
      "InsightsUsage and focus rhythm",
      "HistoryLocal records",
      "SocialGlobal focus leaderboard",
      "SettingsApp preferences",
    ]);
  });

  it("uses Calendar, Agents, then Review order when the navigation refresh is on", () => {
    render(
      <LocalizationTestProvider language="en">
        <CommandBar includeProjects navigationRefreshEnabled onDismiss={vi.fn()} onNavigate={vi.fn()} />
      </LocalizationTestProvider>,
    );

    const navigation = screen.getByRole("group", { name: "Navigate" });
    expect(within(navigation).getAllByRole("button").map((button) => button.textContent)).toEqual([
      "CalendarToday at a glance⌘1",
      "AgentsLocal agent sessions and output⌘2",
      "ProjectsTime grouped by project⌘3",
      "ClassificationActivity breakdown⌘4",
      "InsightsUsage and focus rhythm⌘5",
      "HistoryLocal records⌘6",
      "LeaderboardGlobal focus leaderboard⌘7",
      "SettingsApp preferences⌘,",
    ]);
  });

  it("uses Korean labels for global navigation", () => {
    render(
      <LocalizationTestProvider language="ko">
        <CommandBar navigationRefreshEnabled includeProjects onDismiss={vi.fn()} onNavigate={vi.fn()} />
      </LocalizationTestProvider>,
    );

    expect(screen.getByRole("dialog", { name: "명령 팔레트" })).toBeTruthy();
    expect(screen.getByRole("textbox", { name: "명령 검색" }).getAttribute("placeholder")).toBe("명령을 입력하거나 검색하세요…");
    expect(screen.getByText("이동")).toBeTruthy();
    expect(screen.getByRole("button", { name: "캘린더 오늘 한눈에 보기" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "에이전트 로컬 에이전트 세션과 결과" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "프로젝트 프로젝트별 사용 시간" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "설정 앱 환경설정" })).toBeTruthy();
  });

  it("keeps the palette visible through parent dismiss until exit finishes", async () => {
    const onDismiss = vi.fn();
    function Harness() {
      const [open, setOpen] = useState(true);
      return (
        <ModalPresence>
          {open ? (
            <CommandBar
              navigationRefreshEnabled
              includeProjects
              onDismiss={() => {
                onDismiss();
                setOpen(false);
              }}
              onNavigate={vi.fn()}
            />
          ) : null}
        </ModalPresence>
      );
    }

    render(
      <LocalizationTestProvider language="ko">
        <Harness />
      </LocalizationTestProvider>,
    );

    expect(screen.getByRole("dialog", { name: "명령 팔레트" })).toBeTruthy();
    await waitFor(() => expect(screen.getByRole("textbox", { name: "명령 검색" })).toBe(document.activeElement));
    fireEvent.keyDown(screen.getByRole("textbox", { name: "명령 검색" }), { key: "Escape" });
    expect(onDismiss).toHaveBeenCalledTimes(1);
    expect(screen.getByRole("dialog", { name: "명령 팔레트" })).toBeTruthy();
    await waitFor(() => expect(screen.queryByRole("dialog", { name: "명령 팔레트" })).toBeNull());
  });

  it("filters command items based on search query", async () => {
    render(
      <LocalizationTestProvider language="ko">
        <CommandBar navigationRefreshEnabled includeProjects onDismiss={vi.fn()} onNavigate={vi.fn()} />
      </LocalizationTestProvider>,
    );

    const searchInput = screen.getByRole("textbox", { name: "명령 검색" });
    fireEvent.change(searchInput, { target: { value: "설정" } });

    expect(screen.getByRole("button", { name: "설정 앱 환경설정" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "AI 설정 바로가기 AI 분석 모델 및 프라이버시 설정" })).toBeTruthy();
    expect(screen.queryByRole("button", { name: "캘린더 오늘 한눈에 보기" })).toBeNull();
  });

  it("shows empty state when no commands match query", async () => {
    render(
      <LocalizationTestProvider language="ko">
        <CommandBar navigationRefreshEnabled includeProjects onDismiss={vi.fn()} onNavigate={vi.fn()} />
      </LocalizationTestProvider>,
    );

    const searchInput = screen.getByRole("textbox", { name: "명령 검색" });
    fireEvent.change(searchInput, { target: { value: "xyznonexistent" } });

    expect(screen.getByText("일치하는 명령이 없습니다")).toBeTruthy();
    expect(screen.getByText("탭 이름, 기능, 또는 설정 키워드로 검색해보세요")).toBeTruthy();
  });

  it("supports keyboard arrow navigation and Enter selection", async () => {
    const onNavigate = vi.fn();
    render(
      <LocalizationTestProvider language="ko">
        <CommandBar navigationRefreshEnabled includeProjects onDismiss={vi.fn()} onNavigate={onNavigate} />
      </LocalizationTestProvider>,
    );

    const searchInput = screen.getByRole("textbox", { name: "명령 검색" });

    // Default selection is first item (Calendar)
    const calendarBtn = screen.getByRole("button", { name: "캘린더 오늘 한눈에 보기" });
    expect(calendarBtn.getAttribute("data-selected")).toBe("true");

    // ArrowDown follows the primary navigation order to Agents
    fireEvent.keyDown(searchInput, { key: "ArrowDown" });
    const agentsBtn = screen.getByRole("button", { name: "에이전트 로컬 에이전트 세션과 결과" });
    expect(agentsBtn.getAttribute("data-selected")).toBe("true");

    // Enter activates the selected item
    fireEvent.keyDown(searchInput, { key: "Enter" });
    expect(onNavigate).toHaveBeenCalledWith("agents");
  });

  it("triggers quick actions like tracking pause and theme toggle", async () => {
    const onToggleTracking = vi.fn();
    const onToggleTheme = vi.fn();

    render(
      <LocalizationTestProvider language="ko">
        <CommandBar
          navigationRefreshEnabled
          includeProjects
          isTrackingRunning={true}
          onDismiss={vi.fn()}
          onNavigate={vi.fn()}
          onToggleTracking={onToggleTracking}
          onToggleTheme={onToggleTheme}
        />
      </LocalizationTestProvider>,
    );

    const pauseBtn = screen.getByRole("button", { name: "추적 일시정지 활동 기록을 일시정지합니다" });
    fireEvent.click(pauseBtn);
    expect(onToggleTracking).toHaveBeenCalledTimes(1);

    const themeBtn = screen.getByRole("button", { name: "테마 전환 라이트 및 다크 모드로 전환합니다" });
    fireEvent.click(themeBtn);
    expect(onToggleTheme).toHaveBeenCalledTimes(1);
  });
});
