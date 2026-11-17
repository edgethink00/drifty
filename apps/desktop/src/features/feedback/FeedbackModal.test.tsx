// @vitest-environment jsdom

import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { LocalizationTestProvider } from "../localization/LocalizationContext";
import { FeedbackModal } from "./FeedbackModal";
import type { FeedbackDiagnostics } from "./feedbackDiagnostics";
import { submitFeedback, type FeedbackResult } from "./feedbackService";
vi.mock("./feedbackService", () => ({ submitFeedback: vi.fn() }));
const openUrl = vi.hoisted(() => vi.fn());
vi.mock("@tauri-apps/plugin-opener", () => ({ openUrl }));
afterEach(() => {
  cleanup();
  vi.mocked(submitFeedback).mockReset();
  openUrl.mockReset();
});

const diagnostics = {
  schemaVersion: 1,
  generatedAt: "2026-10-13T12:00:00.000Z",
  entryPoint: "account_menu",
  highlights: ["tracker_not_running"],
} as unknown as FeedbackDiagnostics;

describe("FeedbackModal", () => {
  it("falls back to secure random bytes when UUID generation throws", async () => {
    vi.mocked(submitFeedback).mockResolvedValue({ success: false, error: "Unable to send feedback right now." });
    const uuid = vi.spyOn(crypto, "randomUUID").mockImplementation(() => { throw new Error("UUID unavailable"); });
    try {
      render(<FeedbackModal initialEmail="fixture@example.com" onClose={vi.fn()} />);
      fireEvent.change(screen.getByRole("textbox", { name: "Message" }), { target: { value: "Keep this draft" } });
      await act(async () => fireEvent.click(screen.getByRole("button", { name: "Send" })));
      expect(vi.mocked(submitFeedback).mock.calls[0][0].submissionId)
        .toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
      expect(screen.getByRole("button", { name: "Send" })).toHaveProperty("disabled", false);
    } finally { uuid.mockRestore(); }
  });

  it("keeps sending available when both optional retry ID APIs throw", async () => {
    vi.mocked(submitFeedback).mockResolvedValue({ success: false, error: "Unable to send feedback right now." });
    const uuid = vi.spyOn(crypto, "randomUUID").mockImplementation(() => { throw new Error("UUID unavailable"); });
    const random = vi.spyOn(crypto, "getRandomValues").mockImplementation(() => { throw new Error("Random unavailable"); });
    try {
      render(<FeedbackModal initialEmail="fixture@example.com" onClose={vi.fn()} />);
      fireEvent.change(screen.getByRole("textbox", { name: "Message" }), { target: { value: "Keep this draft" } });
      await act(async () => fireEvent.click(screen.getByRole("button", { name: "Send" })));
      expect(submitFeedback).toHaveBeenCalledTimes(1);
      expect(vi.mocked(submitFeedback).mock.calls[0][0].submissionId).toBeUndefined();
      expect(screen.getByRole("button", { name: "Send" })).toHaveProperty("disabled", false);
      expect(screen.getByRole("textbox", { name: "Message" })).toHaveProperty("value", "Keep this draft");
    } finally { uuid.mockRestore(); random.mockRestore(); }
  });

  it("reuses the draft ID after failure and rotates it when the message changes", async () => {
    vi.mocked(submitFeedback).mockResolvedValue({ success: false, error: "Unable to send feedback right now." });
    render(<FeedbackModal initialEmail="fixture@example.com" onClose={vi.fn()} />);
    const message = screen.getByRole("textbox", { name: "Message" });
    fireEvent.change(message, { target: { value: "Keep this draft" } });
    await act(async () => fireEvent.click(screen.getByRole("button", { name: "Send" })));
    const id = vi.mocked(submitFeedback).mock.calls[0][0].submissionId;
    expect(id).toMatch(/^[0-9a-f-]{36}$/);
    await act(async () => fireEvent.click(screen.getByRole("button", { name: "Send" })));
    expect(vi.mocked(submitFeedback).mock.calls[1][0].submissionId).toBe(id);
    fireEvent.change(message, { target: { value: "A new draft" } });
    await act(async () => fireEvent.click(screen.getByRole("button", { name: "Send" })));
    expect(vi.mocked(submitFeedback).mock.calls[2][0].submissionId).not.toBe(id);
  });

  it("separates an edited email and a replacement image with identical file metadata", async () => {
    vi.mocked(submitFeedback).mockResolvedValue({ success: false, error: "Unable to send feedback right now." });
    render(<FeedbackModal onClose={vi.fn()} />);
    const email = screen.getByRole("textbox", { name: "Email" });
    fireEvent.change(email, { target: { value: "fixture@example.com" } });
    fireEvent.change(screen.getByRole("textbox", { name: "Message" }), { target: { value: "Image report" } });
    const upload = screen.getByLabelText("Attach images");
    const options = { type: "image/png", lastModified: 1234 };
    fireEvent.change(upload, { target: { files: [new File(["first"], "qa.png", options)] } });
    const send = async (count: number) => {
      await act(async () => {
        fireEvent.click(screen.getByRole("button", { name: "Send" }));
        await vi.waitFor(() => expect(submitFeedback).toHaveBeenCalledTimes(count));
      });
      return vi.mocked(submitFeedback).mock.calls[count - 1][0];
    };
    const first = await send(1);
    expect((await send(2)).submissionId).toBe(first.submissionId);
    fireEvent.change(email, { target: { value: "other@example.com" } });
    const editedEmail = await send(3);
    expect(editedEmail.submissionId).not.toBe(first.submissionId);
    fireEvent.click(screen.getByRole("button", { name: "Remove qa.png" }));
    fireEvent.change(upload, { target: { files: [new File(["other"], "qa.png", options)] } });
    const editedImage = await send(4);
    expect(editedImage.attachments?.[0]).toMatchObject({ filename: "qa.png", size: 5 });
    expect(editedImage.attachments?.[0].content).not.toBe(first.attachments?.[0].content);
    expect(editedImage.submissionId).not.toBe(editedEmail.submissionId);
    expect((await send(5)).submissionId).toBe(editedImage.submissionId);
  });

  it("starts a new identity for another report and for a reopened dialog", async () => {
    vi.mocked(submitFeedback).mockResolvedValue({ success: true, diagnosticsIncluded: false });
    const { unmount } = render(<FeedbackModal initialEmail="fixture@example.com" onClose={vi.fn()} />);
    const send = async () => {
      fireEvent.change(screen.getByRole("textbox", { name: "Message" }), { target: { value: "Same report text" } });
      await act(async () => fireEvent.click(screen.getByRole("button", { name: "Send" })));
      return vi.mocked(submitFeedback).mock.lastCall![0].submissionId;
    };
    const first = await send();
    fireEvent.click(screen.getByRole("button", { name: "Send another" }));
    const next = await send();
    expect(next).not.toBe(first);
    unmount();
    render(<FeedbackModal initialEmail="fixture@example.com" onClose={vi.fn()} />);
    const reopened = await send();
    expect(reopened).not.toBe(first);
    expect(reopened).not.toBe(next);
  });

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

  it("offers Book a call above the fields, opens only the booking page and keeps it after sending", async () => {
    vi.mocked(submitFeedback).mockResolvedValueOnce({ success: true, diagnosticsIncluded: false });
    render(<FeedbackModal initialEmail="person@example.com" onClose={vi.fn()} />);
    const message = screen.getByRole("textbox", { name: "Message" });
    fireEvent.change(message, { target: { value: "Private draft" } });

    const talk = screen.getByRole("link", { name: "Book a call" });
    const email = screen.getByRole("textbox", { name: "Email" });
    expect(talk.compareDocumentPosition(email) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(talk.getAttribute("href")).toBe("https://cal.com/drifty/15min");
    await act(async () => fireEvent.click(talk));
    expect(openUrl).toHaveBeenCalledExactlyOnceWith("https://cal.com/drifty/15min");
    expect(message).toHaveProperty("value", "Private draft");

    await act(async () => fireEvent.click(screen.getByRole("button", { name: "Send" })));
    expect(screen.getByRole("link", { name: "Book a call" })).toBeTruthy();
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
