// @vitest-environment jsdom

import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { LocalizationTestProvider } from "../localization/LocalizationContext";
import { FeedbackModal } from "./FeedbackModal";

describe("FeedbackModal", () => {
  it("renders and validates the Korean feedback flow", () => {
    render(
      <LocalizationTestProvider language="ko">
        <FeedbackModal initialEmail="person@example.com" onClose={vi.fn()} />
      </LocalizationTestProvider>,
    );

    expect(screen.getByRole("dialog", { name: "피드백 보내기" }).textContent).toContain(
      "불편한 점, 빠진 기능, Drifty가 더 좋아질 방법을 알려주세요.",
    );
    expect(screen.getByRole("button", { name: "보내기" })).toBeTruthy();
    expect(screen.getByText("이미지 첨부")).toBeTruthy();
    expect(screen.getByRole("textbox", { name: "이메일" })).toBeTruthy();
    expect(screen.getByRole("textbox", { name: "피드백 내용" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "취소" })).toBeTruthy();
    expect(screen.queryByText("Send feedback")).toBeNull();
    expect(screen.queryByText("Attach images")).toBeNull();

    fireEvent.click(screen.getByRole("button", { name: "보내기" }));
    expect(screen.getByRole("alert").textContent).toContain("피드백 내용을 짧게 적어 주세요.");
  });
});
