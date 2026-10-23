// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@tauri-apps/api/core", () => ({ invoke: vi.fn(), Channel: class {} }));

import { LocalizationTestProvider } from "../localization/LocalizationContext";
import {
  DEFAULT_AI_PRIVACY_REQUEST_SETTINGS,
  saveAiPrivacyRequestSettings,
  updateAiPrivacyRequestOptionalSetting,
} from "../settings/aiPrivacyRequestSettings";
import type { ChatClient, ChatSendRequest } from "./chatClient";
import { CHAT_COPY } from "./chatCopy";
import { ChatAnswerText, ChatPage, groupChatConversations } from "./ChatPage";
import type { ChatConversation, ChatRunExit, ChatRuntimeStatus } from "./chatTypes";

const READY: ChatRuntimeStatus = {
  providers: [
    { provider: "codex", installed: true, version: "codex-cli 0.162.0" },
    { provider: "claude", installed: false, version: null },
  ],
  toolsAvailable: true,
  toolsMessage: null,
};

const FENCE = "\u0060\u0060\u0060";

type Pending = { readonly request: ChatSendRequest; readonly onLine: (line: string) => void; readonly finish: (exit: ChatRunExit) => void };

function fakeClient(status: ChatRuntimeStatus = READY) {
  const pending: Pending[] = [];
  const cancel = vi.fn(async (requestId: string) => {
    const run = pending.find((entry) => entry.request.requestId === requestId);
    run?.finish({ code: null, cancelled: true, stderrTail: "" });
  });
  const client: ChatClient = {
    kind: "native",
    getStatus: async () => status,
    send: (request, onLine) => new Promise((finish) => { pending.push({ request, onLine, finish }); }),
    cancel,
  };
  return { client, pending, cancel };
}

const line = (event: unknown) => JSON.stringify(event);
const toolStarted = (id: string, tool: string, args: Record<string, unknown>) => line({ type: "item.started", item: { id, type: "mcp_tool_call", tool, arguments: args, status: "in_progress" } });
const toolDone = (id: string, tool: string, args: Record<string, unknown>, status = "completed") => line({ type: "item.completed", item: { id, type: "mcp_tool_call", tool, arguments: args, status } });
const message = (id: string, text: string) => line({ type: "item.completed", item: { id, type: "agent_message", text } });

beforeEach(() => {
  window.localStorage.clear();
});
afterEach(() => cleanup());

describe("Chat page", () => {
  it("answers from the agent's stream, offers its follow-ups and keeps the chat on this computer", async () => {
    const { client, pending } = fakeClient();
    render(<LocalizationTestProvider language="ko"><ChatPage client={client} now={() => new Date(2026, 9, 24, 10, 0)} /></LocalizationTestProvider>);
    expect(screen.getByText("기록에 대해 물어보세요")).toBeTruthy();
    const input = await screen.findByLabelText("기록에 대해 물어보세요…");
    await waitFor(() => expect((screen.getByRole("option", { name: "Claude Code (설치 필요)" }) as HTMLOptionElement)).toBeTruthy());
    fireEvent.change(input, { target: { value: "어제 뭐 했어?" } });
    fireEvent.keyDown(input, { key: "Enter" });

    await waitFor(() => expect(pending).toHaveLength(1));
    expect(pending[0].request.provider).toBe("codex");
    expect(pending[0].request.detail).toBe("titles");
    expect(pending[0].request.prompt).toBe("어제 뭐 했어?");
    expect(pending[0].request.instructions).toContain("2026-10-24 10:00");
    expect(screen.getByText("기록을 확인하는 중…")).toBeTruthy();

    act(() => {
      pending[0].onLine(toolStarted("t1", "summary", { day: "2026-10-23" }));
    });
    expect(screen.getByText("10월 23일 기록 요약")).toBeTruthy();
    expect(screen.getByLabelText("멈추기")).toBeTruthy();

    act(() => {
      pending[0].onLine(toolDone("t1", "summary", { day: "2026-10-23" }));
      pending[0].onLine(message("m0", "어제 기록을 확인할게요."));
      pending[0].onLine(message("m1", "어제는 **Figma**를 가장 오래 썼어요.\n\n- Figma 1시간 40분\n- VS Code 1시간 35분\n\n" + FENCE + "suggestions\n[\"오후엔 뭐 했어?\", \"지난주 같은 요일은?\", \"가장 긴 집중은?\"]\n" + FENCE));
      pending[0].onLine(line({ type: "turn.completed" }));
      pending[0].finish({ code: 0, cancelled: false, stderrTail: "" });
    });

    await waitFor(() => expect(screen.getByText("Figma", { selector: "strong" })).toBeTruthy());
    expect(screen.getByText("Figma 1시간 40분")).toBeTruthy();
    expect(screen.queryByText(/suggestions/)).toBeNull();
    expect(screen.getByText("이어서 물어보기")).toBeTruthy();
    const saved = JSON.parse(window.localStorage.getItem("drifty.chat.conversations.v1") ?? "[]");
    expect(saved[0].title).toBe("어제 뭐 했어?");
    expect(saved[0].turns[0].status).toBe("done");
    expect(saved[0].turns[0].answer).not.toContain("suggestions");
    expect(saved[0].turns[0].suggestions).toEqual(["오후엔 뭐 했어?", "지난주 같은 요일은?", "가장 긴 집중은?"]);

    // Follow-ups stay while the user types, and one click asks it with the earlier ones marked as already offered.
    fireEvent.change(input, { target: { value: "다른 질문" } });
    fireEvent.click(screen.getByRole("button", { name: "지난주 같은 요일은?" }));
    await waitFor(() => expect(pending).toHaveLength(2));
    expect(pending[1].request.prompt).toContain("New question from the user:\n지난주 같은 요일은?");
    expect(pending[1].request.instructions).toContain("Do not repeat these earlier follow-ups");
    expect(pending[1].request.instructions).toContain("\"오후엔 뭐 했어?\"");
  });

  it("folds finished record lookups into one line and marks a failure the agent recovered from", async () => {
    const { client, pending } = fakeClient();
    render(<LocalizationTestProvider language="ko"><ChatPage client={client} now={() => new Date(2026, 9, 24, 10, 0, 0)} /></LocalizationTestProvider>);
    const input = await screen.findByLabelText("기록에 대해 물어보세요…");
    await waitFor(() => expect(screen.getByRole("option", { name: "Codex" })).toBeTruthy());
    fireEvent.change(input, { target: { value: "어제 프로젝트별로" } });
    fireEvent.keyDown(input, { key: "Enter" });
    await waitFor(() => expect(pending).toHaveLength(1));
    act(() => {
      pending[0].onLine(toolDone("t1", "search", { day: "2026-10-23", query: "" }, "failed"));
      pending[0].onLine(toolDone("t2", "timeline", { day: "2026-10-23" }));
      pending[0].onLine(message("m0", "타임라인으로 다시 볼게요."));
      pending[0].onLine(message("m1", "Drifty에 **4시간** 썼어요."));
      pending[0].finish({ code: 0, cancelled: false, stderrTail: "" });
    });
    const toggle = await screen.findByRole("button", { name: /기록 확인 2회/ });
    expect(toggle.getAttribute("aria-expanded")).toBe("false");
    expect(screen.queryByText("타임라인으로 다시 볼게요.")).toBeNull();
    expect(screen.queryByText("10월 23일 타임라인")).toBeNull();
    fireEvent.click(toggle);
    expect(toggle.getAttribute("aria-expanded")).toBe("true");
    const steps = screen.getByRole("list", { name: "확인한 기록" });
    expect(within(steps).getByText("다시 확인함")).toBeTruthy();
    expect(within(steps).queryByText("실패")).toBeNull();
    expect(screen.getByText("타임라인으로 다시 볼게요.")).toBeTruthy();
  });

  it("starts from a suggested task card, showing its title and sending its fuller request", async () => {
    const { client, pending, cancel } = fakeClient();
    render(<LocalizationTestProvider language="en"><ChatPage client={client} /></LocalizationTestProvider>);
    expect(screen.getByText("Suggested tasks")).toBeTruthy();
    const card = await screen.findByRole("button", { name: "Yesterday's standup" });
    await waitFor(() => expect((card as HTMLButtonElement).disabled).toBe(false));
    fireEvent.click(card);
    await waitFor(() => expect(pending).toHaveLength(1));
    expect(pending[0].request.prompt).toContain("Yesterday / Today / Blockers");
    expect(screen.getAllByText("Yesterday's standup").length).toBeGreaterThan(0);
    fireEvent.click(screen.getByLabelText("Stop"));
    await waitFor(() => expect(cancel).toHaveBeenCalledWith(pending[0].request.requestId));
    await waitFor(() => expect(screen.getByText("Stopped.")).toBeTruthy());
  });

  it("opens the task menu with /, filters it and runs the highlighted task with Enter", async () => {
    const { client, pending } = fakeClient();
    render(<LocalizationTestProvider language="en"><ChatPage client={client} projectNames={["Northstar"]} /></LocalizationTestProvider>);
    const input = await screen.findByLabelText("Ask about your records…");
    await waitFor(() => expect(screen.getByRole("option", { name: "Codex" })).toBeTruthy());
    fireEvent.change(input, { target: { value: "/" } });
    const menu = screen.getByRole("listbox", { name: "Suggested tasks" });
    expect(within(menu).getAllByRole("option").length).toBe(8);
    expect(within(menu).getByText("Time on Northstar")).toBeTruthy();
    fireEvent.change(input, { target: { value: "/northstar" } });
    expect(within(menu).getAllByRole("option").map((option) => option.getAttribute("aria-selected"))).toEqual(["true"]);
    expect((screen.getByLabelText("Send") as HTMLButtonElement).disabled).toBe(true);
    fireEvent.keyDown(input, { key: "Enter" });
    await waitFor(() => expect(pending).toHaveLength(1));
    expect(pending[0].request.prompt).toBe("How much did I work on the Northstar project this week, and on what?");
    expect(screen.queryByRole("listbox")).toBeNull();
    expect((input as HTMLTextAreaElement).value).toBe("");
  });

  it("closes the task menu with Escape without sending anything", async () => {
    const { client, pending } = fakeClient();
    render(<LocalizationTestProvider language="en"><ChatPage client={client} /></LocalizationTestProvider>);
    const input = await screen.findByLabelText("Ask about your records…");
    fireEvent.click(screen.getByRole("button", { name: "Suggested tasks" }));
    expect(screen.getByRole("listbox", { name: "Suggested tasks" })).toBeTruthy();
    fireEvent.keyDown(input, { key: "Escape" });
    expect(screen.queryByRole("listbox")).toBeNull();
    expect(pending).toHaveLength(0);
  });

  it("withholds titles from the agent while the AI privacy Window title switch is off", async () => {
    saveAiPrivacyRequestSettings(updateAiPrivacyRequestOptionalSetting(DEFAULT_AI_PRIVACY_REQUEST_SETTINGS, "windowTitle", false));
    const { client, pending } = fakeClient();
    render(<LocalizationTestProvider language="en"><ChatPage client={client} /></LocalizationTestProvider>);
    const card = await screen.findByRole("button", { name: "Yesterday's standup" });
    await waitFor(() => expect((card as HTMLButtonElement).disabled).toBe(false));
    fireEvent.click(card);
    await waitFor(() => expect(pending).toHaveLength(1));
    expect(pending[0].request.detail).toBe("safe");
  });

  it("explains a failed answer and asks the same request again", async () => {
    const { client, pending } = fakeClient();
    render(<LocalizationTestProvider language="en"><ChatPage client={client} /></LocalizationTestProvider>);
    const card = await screen.findByRole("button", { name: "Today so far" });
    await waitFor(() => expect((card as HTMLButtonElement).disabled).toBe(false));
    fireEvent.click(card);
    await waitFor(() => expect(pending).toHaveLength(1));
    act(() => pending[0].finish({ code: 1, cancelled: false, stderrTail: "Reading additional input from stdin...\nError: not logged in\n" }));
    await waitFor(() => expect(screen.getByRole("alert").textContent).toContain("Error: not logged in"));
    fireEvent.click(screen.getByRole("button", { name: "Ask again" }));
    await waitFor(() => expect(pending).toHaveLength(2));
    expect(pending[1].request.prompt).toContain("Summarize what I did today so far");
  });

  it("keeps sending off for a connection that is not installed or not ready", async () => {
    const { client } = fakeClient({ ...READY, providers: [{ provider: "codex", installed: false, version: null }] });
    render(<LocalizationTestProvider language="en"><ChatPage client={client} /></LocalizationTestProvider>);
    await waitFor(() => expect(screen.getByText("Codex CLI isn't on this computer. Install it and sign in to use it.")).toBeTruthy());
    const input = screen.getByLabelText("Ask about your records…");
    fireEvent.change(input, { target: { value: "hello" } });
    expect((screen.getByLabelText("Send") as HTMLButtonElement).disabled).toBe(true);
    expect((screen.getByRole("button", { name: "Yesterday's standup" }) as HTMLButtonElement).disabled).toBe(true);
    expect((screen.getByRole("option", { name: "Drifty Cloud (coming soon)" }) as HTMLOptionElement).disabled).toBe(true);
  });
});

describe("chat list groups", () => {
  it("groups chats into today, yesterday, the previous seven days and older", () => {
    const at = (iso: string): ChatConversation => ({ id: iso, title: iso, createdAt: iso, updatedAt: iso, turns: [] });
    const groups = groupChatConversations(
      [at("2026-10-24T08:00:00"), at("2026-10-23T22:00:00"), at("2026-10-20T09:00:00"), at("2026-10-01T09:00:00")],
      new Date(2026, 9, 24, 12, 0),
      CHAT_COPY.en,
    );
    expect(groups.map((group) => [group.label, group.conversations.length])).toEqual([["Today", 1], ["Yesterday", 1], ["Previous 7 days", 1], ["Older", 1]]);
  });
});

describe("answer text", () => {
  it("renders a label line followed by bullets as a labelled list, not literal dashes", () => {
    const { container } = render(<ChatAnswerText text={"어제 한 일 (2026-10-23)\n- Figma 1시간 40분\n- Slack 25분\n\n막힌 점\n- 기록에 없음\n\nIntro line\nsecond line"} />);
    expect(container.querySelectorAll("ul")).toHaveLength(2);
    expect([...container.querySelectorAll(".chat-answer__heading")].map((node) => node.textContent)).toEqual(["어제 한 일 (2026-10-23)", "막힌 점"]);
    expect(container.textContent).not.toContain("- Figma");
    expect(container.querySelector("p:not(.chat-answer__heading)")?.textContent).toBe("Intro linesecond line");
  });
});

