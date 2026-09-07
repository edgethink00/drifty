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
});
