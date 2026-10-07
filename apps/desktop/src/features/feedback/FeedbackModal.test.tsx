// @vitest-environment jsdom

import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { LocalizationTestProvider } from "../localization/LocalizationContext";
import { FeedbackModal } from "./FeedbackModal";
import { submitFeedback, type FeedbackResult } from "./feedbackService";
vi.mock("./feedbackService", () => ({ submitFeedback: vi.fn() }));
afterEach(cleanup);

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

  it("marks the already-blocked close button disabled while sending and restores it after failure", async () => {
    let finish!: (result: FeedbackResult) => void;
    vi.mocked(submitFeedback).mockImplementationOnce(() => new Promise((resolve) => { finish = resolve; }));
    const close = vi.fn();
    render(<FeedbackModal initialEmail="person@example.com" onClose={close} />);
    const message = screen.getByRole("textbox", { name: "Message" });
    fireEvent.change(message, { target: { value: "Keep this note" } });
    await act(async () => fireEvent.click(screen.getByRole("button", { name: "Send" })));
    const x = screen.getByRole("button", { name: "Close feedback dialog" });
    expect(x).toHaveProperty("disabled", true);
    fireEvent.click(x);
    fireEvent.keyDown(window, { key: "Escape" });
    expect(close).not.toHaveBeenCalled();
    await act(async () => finish({ success: false, error: "Unable to send feedback right now." }));
    expect(x).toHaveProperty("disabled", false);
    expect(message).toHaveProperty("value", "Keep this note");
    fireEvent.click(x);
    expect(close).toHaveBeenCalledTimes(1);
  });
});
