// @vitest-environment jsdom

import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { LocalizationTestProvider } from "../localization/LocalizationContext";
import { CommandBar } from "./CommandBar";

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
});
