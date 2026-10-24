// @vitest-environment jsdom

import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { LocalizationTestProvider } from "../localization/LocalizationContext";
import { FeedbackModal } from "./FeedbackModal";
import type { FeedbackDiagnostics } from "./feedbackDiagnostics";
import { submitFeedback, type FeedbackResult } from "./feedbackService";
vi.mock("./feedbackService", () => ({ submitFeedback: vi.fn() }));
afterEach(() => {
  cleanup();
  vi.mocked(submitFeedback).mockReset();
});

const diagnostics = {
  schemaVersion: 1,
  generatedAt: "2026-10-13T12:00:00.000Z",
  entryPoint: "account_menu",
  highlights: ["tracker_not_running"],
} as unknown as FeedbackDiagnostics;

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

  it("includes debug logs by default with one checkbox and nothing to read", async () => {
    vi.mocked(submitFeedback).mockResolvedValueOnce({ success: true, diagnosticsIncluded: true });
    const collectDiagnostics = vi.fn().mockResolvedValue(diagnostics);
    render(<FeedbackModal initialEmail="person@example.com" onClose={vi.fn()} collectDiagnostics={collectDiagnostics} />);

    const checkbox = screen.getByRole("checkbox", { name: "Include debug logs" });
    expect(checkbox).toHaveProperty("checked", true);
    // Owner choice (B): it sits in the footer beside Attach images.
    expect(checkbox.closest(".feedback-modal__attach-group")?.textContent).toContain("Attach images");
    // The owner asked for the checkbox alone: no explanation, preview or extra controls.
    expect(screen.getAllByRole("checkbox")).toHaveLength(1);
    expect(screen.queryByText(/activity history|what's sent|diagnostic info/i)).toBeNull();
    expect(collectDiagnostics).not.toHaveBeenCalled();

    fireEvent.change(screen.getByRole("textbox", { name: "Message" }), { target: { value: "Tracking stopped" } });
    await act(async () => fireEvent.click(screen.getByRole("button", { name: "Send" })));

    expect(collectDiagnostics).toHaveBeenCalledTimes(1);
    expect(submitFeedback).toHaveBeenCalledWith(expect.objectContaining({ message: "Tracking stopped", diagnostics }));
    expect(screen.getByRole("status").textContent).not.toMatch(/debug log|diagnostic/i);
  });

  it("sends without a debug log once the person unchecks it", async () => {
    vi.mocked(submitFeedback).mockResolvedValueOnce({ success: true, diagnosticsIncluded: false });
    const collectDiagnostics = vi.fn().mockResolvedValue(diagnostics);
    render(<FeedbackModal initialEmail="person@example.com" onClose={vi.fn()} collectDiagnostics={collectDiagnostics} />);

    fireEvent.click(screen.getByRole("checkbox", { name: "Include debug logs" }));
    fireEvent.change(screen.getByRole("textbox", { name: "Message" }), { target: { value: "Idea: timers" } });
    await act(async () => fireEvent.click(screen.getByRole("button", { name: "Send" })));

    expect(collectDiagnostics).not.toHaveBeenCalled();
    expect(submitFeedback).toHaveBeenCalledWith(expect.objectContaining({ diagnostics: null }));
  });

  it("attaches a pasted screenshot and still pastes text normally", async () => {
    vi.mocked(submitFeedback).mockResolvedValueOnce({ success: true, diagnosticsIncluded: false });
    render(<FeedbackModal initialEmail="person@example.com" onClose={vi.fn()} />);
    const message = screen.getByRole("textbox", { name: "Message" });
    const clipboard = (files: File[], text = "") => ({ files, items: [], getData: (type: string) => (type === "text/plain" ? text : "") });

    // An image-only paste attaches the image and types nothing.
    const screenshot = new File([new Uint8Array([137, 80, 78, 71])], "image.png", { type: "image/png" });
    expect(fireEvent.paste(message, { clipboardData: clipboard([screenshot]) })).toBe(false);
    expect(screen.getByRole("list", { name: "Selected images" }).textContent).toContain("pasted-image-1.png");

    // A copied file keeps its name, and text that comes with it still pastes.
    const copied = new File([new Uint8Array([255, 216, 255])], "settings-gap.jpg", { type: "image/jpeg" });
    expect(fireEvent.paste(message, { clipboardData: clipboard([copied], "settings-gap.jpg") })).toBe(true);
    expect(screen.getByRole("list", { name: "Selected images" }).textContent).toContain("settings-gap.jpg");

    // Plain text and other files leave the attachments alone.
    const notes = new File(["notes"], "notes.txt", { type: "text/plain" });
    expect(fireEvent.paste(message, { clipboardData: clipboard([notes], "notes") })).toBe(true);
    expect(screen.getAllByRole("button", { name: /^Remove / })).toHaveLength(2);

    fireEvent.change(message, { target: { value: "Settings spacing looks off" } });
    await act(async () => fireEvent.click(screen.getByRole("button", { name: "Send" })));
    // Attachments are read with FileReader before the report goes out.
    await act(async () => vi.waitFor(() => expect(submitFeedback).toHaveBeenCalled()));
    expect(submitFeedback).toHaveBeenCalledWith(expect.objectContaining({
      attachments: [
        expect.objectContaining({ filename: "pasted-image-1.png", contentType: "image/png" }),
        expect.objectContaining({ filename: "settings-gap.jpg", contentType: "image/jpeg" }),
      ],
    }));
  });

  it("applies the attachment limits to pasted images", () => {
    render(<FeedbackModal initialEmail="person@example.com" onClose={vi.fn()} />);
    const message = screen.getByRole("textbox", { name: "Message" });
    const huge = new File([new Uint8Array(5 * 1024 * 1024 + 1)], "image.png", { type: "image/png" });

    fireEvent.paste(message, { clipboardData: { files: [huge], items: [], getData: () => "" } });

    expect(screen.queryByRole("list", { name: "Selected images" })).toBeNull();
    expect(screen.getByRole("alert").textContent).toContain("5 MB");
  });

  it("still sends the message when the debug log cannot be read", async () => {
    vi.mocked(submitFeedback).mockResolvedValueOnce({ success: true, diagnosticsIncluded: false });
    const collectDiagnostics = vi.fn().mockRejectedValue(new Error("native read failed"));
    render(<FeedbackModal initialEmail="person@example.com" onClose={vi.fn()} collectDiagnostics={collectDiagnostics} />);

    fireEvent.change(screen.getByRole("textbox", { name: "Message" }), { target: { value: "Crash on wake" } });
    await act(async () => fireEvent.click(screen.getByRole("button", { name: "Send" })));
    expect(submitFeedback).toHaveBeenCalledWith(expect.objectContaining({ message: "Crash on wake", diagnostics: null }));
    expect(screen.getByRole("status").textContent).toContain("We got your feedback.");
  });

  it("offers no debug log option where the app cannot read one", () => {
    render(
      <LocalizationTestProvider language="ko">
        <FeedbackModal initialEmail="person@example.com" onClose={vi.fn()} />
      </LocalizationTestProvider>,
    );
    expect(screen.queryByRole("checkbox")).toBeNull();
    expect(screen.queryByText("디버그 로그 포함")).toBeNull();
  });

  it("labels the debug log option in Korean", () => {
    render(
      <LocalizationTestProvider language="ko">
        <FeedbackModal initialEmail="person@example.com" onClose={vi.fn()} collectDiagnostics={vi.fn().mockResolvedValue(diagnostics)} />
      </LocalizationTestProvider>,
    );
    expect(screen.getByRole("checkbox", { name: "디버그 로그 포함" })).toHaveProperty("checked", true);
  });
  it("sends with ⌘/Ctrl+Enter from the message while plain Enter stays a newline", async () => {
    vi.mocked(submitFeedback).mockClear();
    vi.mocked(submitFeedback).mockImplementationOnce(() => new Promise(() => {}));
    render(<FeedbackModal initialEmail="person@example.com" onClose={vi.fn()} collectDiagnostics={vi.fn().mockResolvedValue(diagnostics)} />);
    const message = screen.getByRole("textbox", { name: "Message" });
    fireEvent.change(message, { target: { value: "Keep this note" } });
    expect(screen.getByRole("button", { name: "Send" }).getAttribute("aria-keyshortcuts")).toBe("Meta+Enter");

    fireEvent.keyDown(message, { key: "Enter" });
    expect(submitFeedback).not.toHaveBeenCalled();

    await act(async () => { fireEvent.keyDown(message, { key: "Enter", ctrlKey: true }); });
    expect(submitFeedback).toHaveBeenCalledTimes(1);
  });

});
