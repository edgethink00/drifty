// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { LocalizationTestProvider } from "../features/localization/LocalizationContext";
import { ProjectColorToken } from "./ProjectColorToken";

afterEach(cleanup);

describe("ProjectColorToken", () => {
  it("localizes color controls in Korean and preserves the selected color value", () => {
    const onPick = vi.fn();
    render(
      <LocalizationTestProvider language="ko">
        <ProjectColorToken
          value="#6366f1"
          swatches={[
            { name: "Indigo", color: "#6366f1" },
            { name: "Pink", color: "#ec4899" },
          ]}
          usedColors={new Set(["#ec4899"])}
          ariaLabel="프로젝트 색상"
          onPick={onPick}
        />
      </LocalizationTestProvider>,
    );

    expect(screen.getByText("인디고")).toBeTruthy();
    expect(screen.getByText("색상 변경")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "인디고 색상 변경" }));
    expect(screen.getByRole("radiogroup", { name: "프로젝트 색상" })).toBeTruthy();

    const usedPink = screen.getByRole("radio", { name: "분홍 색상 (이미 사용 중)" });
    expect(usedPink.getAttribute("title")).toBe("다른 프로젝트에서 사용 중");
    fireEvent.click(usedPink);
    expect(onPick).toHaveBeenCalledWith("#ec4899");
  });
});
