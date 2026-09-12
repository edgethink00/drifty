// @vitest-environment jsdom

import { useState } from "react";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { LocalizationTestProvider } from "../localization/LocalizationContext";
import { CommandBar } from "./CommandBar";
import { ModalPresence } from "../../components/ModalPresence";

afterEach(cleanup);

describe("CommandBar", () => {
  it("uses Korean labels for global navigation", () => {
    render(
      <LocalizationTestProvider language="ko">
        <CommandBar includeProjects onDismiss={vi.fn()} onNavigate={vi.fn()} />
      </LocalizationTestProvider>,
    );

    expect(screen.getByRole("dialog", { name: "명령 팔레트" })).toBeTruthy();
    expect(screen.getByRole("textbox", { name: "명령 검색" }).getAttribute("placeholder")).toBe("명령을 입력하거나 검색하세요…");
    expect(screen.getByText("이동")).toBeTruthy();
    expect(screen.getByRole("button", { name: "대시보드 오늘 한눈에 보기" })).toBeTruthy();
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
        <CommandBar includeProjects onDismiss={vi.fn()} onNavigate={vi.fn()} />
      </LocalizationTestProvider>,
    );

    const searchInput = screen.getByRole("textbox", { name: "명령 검색" });
    fireEvent.change(searchInput, { target: { value: "설정" } });

    expect(screen.getByRole("button", { name: "설정 앱 환경설정" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "AI 설정 바로가기 AI 분석 모델 및 프라이버시 설정" })).toBeTruthy();
    expect(screen.queryByRole("button", { name: "대시보드 오늘 한눈에 보기" })).toBeNull();
  });

  it("shows empty state when no commands match query", async () => {
    render(
      <LocalizationTestProvider language="ko">
        <CommandBar includeProjects onDismiss={vi.fn()} onNavigate={vi.fn()} />
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
        <CommandBar includeProjects onDismiss={vi.fn()} onNavigate={onNavigate} />
      </LocalizationTestProvider>,
    );

    const searchInput = screen.getByRole("textbox", { name: "명령 검색" });

    // Default selection is first item (Dashboard)
    const dashboardBtn = screen.getByRole("button", { name: "대시보드 오늘 한눈에 보기" });
    expect(dashboardBtn.getAttribute("data-selected")).toBe("true");

    // ArrowDown moves selection to Classification
    fireEvent.keyDown(searchInput, { key: "ArrowDown" });
    const classificationBtn = screen.getByRole("button", { name: "분류 활동 분류 내역" });
    expect(classificationBtn.getAttribute("data-selected")).toBe("true");

    // Enter activates the selected item
    fireEvent.keyDown(searchInput, { key: "Enter" });
    expect(onNavigate).toHaveBeenCalledWith("classification");
  });

  it("triggers quick actions like tracking pause and theme toggle", async () => {
    const onToggleTracking = vi.fn();
    const onToggleTheme = vi.fn();

    render(
      <LocalizationTestProvider language="ko">
        <CommandBar
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
