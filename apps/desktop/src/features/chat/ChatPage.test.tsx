// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@tauri-apps/api/core", () => ({ invoke: vi.fn(), Channel: class {} }));

import { LocalizationTestProvider } from "../localization/LocalizationContext";
import {
  DEFAULT_AI_PRIVACY_REQUEST_SETTINGS,
  saveAiPrivacyRequestSettings,
  updateAiPrivacyRequestOptionalSetting,
} from "../settings/aiPrivacyRequestSettings";
import type { ChatClient, ChatSendRequest } from "./chatClient";
import { ChatPage } from "./ChatPage";
import type { ChatRunExit, ChatRuntimeStatus } from "./chatTypes";

const READY: ChatRuntimeStatus = {
  providers: [
    { provider: "codex", installed: true, version: "codex-cli 0.162.0" },
    { provider: "claude", installed: false, version: null },
  ],
  toolsAvailable: true,
  toolsMessage: null,
};

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

beforeEach(() => {
  window.localStorage.clear();
});
afterEach(() => cleanup());

describe("Chat page", () => {
  it("answers from the agent's stream and keeps the chat on this computer", async () => {
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
    expect(pending[0].request.instructions).toContain("2026-10-24 10:00");
    expect(screen.getByText("기록을 확인하는 중…")).toBeTruthy();

    act(() => {
      pending[0].onLine(line({ type: "item.started", item: { id: "t1", type: "mcp_tool_call", tool: "summary", arguments: { day: "2026-10-23" }, status: "in_progress" } }));
    });
    expect(screen.getByText("10월 23일 기록 요약")).toBeTruthy();
    expect(screen.getByLabelText("멈추기")).toBeTruthy();

    act(() => {
      pending[0].onLine(line({ type: "item.completed", item: { id: "t1", type: "mcp_tool_call", tool: "summary", arguments: { day: "2026-10-23" }, status: "completed" } }));
      pending[0].onLine(line({ type: "item.completed", item: { id: "m1", type: "agent_message", text: "어제는 **Figma**를 가장 오래 썼어요.\n\n- Figma 1시간 40분\n- VS Code 1시간 35분" } }));
      pending[0].onLine(line({ type: "turn.completed" }));
      pending[0].finish({ code: 0, cancelled: false, stderrTail: "" });
    });

    await waitFor(() => expect(screen.getByText("Figma", { selector: "strong" })).toBeTruthy());
    expect(screen.getByText("Figma 1시간 40분")).toBeTruthy();
    const saved = JSON.parse(window.localStorage.getItem("drifty.chat.conversations.v1") ?? "[]");
    expect(saved[0].title).toBe("어제 뭐 했어?");
    expect(saved[0].turns[0].status).toBe("done");
    expect(screen.getAllByText("어제 뭐 했어?").length).toBeGreaterThan(0);
  });

  it("stops a running answer", async () => {
    const { client, pending, cancel } = fakeClient();
    render(<LocalizationTestProvider language="en"><ChatPage client={client} /></LocalizationTestProvider>);
    fireEvent.click(await screen.findByRole("button", { name: "What did I do yesterday?" }));
    await waitFor(() => expect(pending).toHaveLength(1));
    fireEvent.click(screen.getByLabelText("Stop"));
    await waitFor(() => expect(cancel).toHaveBeenCalledWith(pending[0].request.requestId));
    await waitFor(() => expect(screen.getByText("Stopped.")).toBeTruthy());
  });

  it("withholds titles from the agent while the AI privacy Window title switch is off", async () => {
    saveAiPrivacyRequestSettings(updateAiPrivacyRequestOptionalSetting(DEFAULT_AI_PRIVACY_REQUEST_SETTINGS, "windowTitle", false));
    const { client, pending } = fakeClient();
    render(<LocalizationTestProvider language="en"><ChatPage client={client} /></LocalizationTestProvider>);
    fireEvent.click(await screen.findByRole("button", { name: "What did I do yesterday?" }));
    await waitFor(() => expect(pending).toHaveLength(1));
    expect(pending[0].request.detail).toBe("safe");
  });

  it("explains a failed answer and offers to ask again", async () => {
    const { client, pending } = fakeClient();
    render(<LocalizationTestProvider language="en"><ChatPage client={client} /></LocalizationTestProvider>);
    fireEvent.click(await screen.findByRole("button", { name: "What did I do yesterday?" }));
    await waitFor(() => expect(pending).toHaveLength(1));
    act(() => pending[0].finish({ code: 1, cancelled: false, stderrTail: "Reading additional input from stdin...\nError: not logged in\n" }));
    await waitFor(() => expect(screen.getByRole("alert").textContent).toContain("Error: not logged in"));
    fireEvent.click(screen.getByRole("button", { name: "Ask again" }));
    await waitFor(() => expect(pending).toHaveLength(2));
    expect(pending[1].request.prompt).toBe("What did I do yesterday?");
  });

  it("keeps sending off for a connection that is not installed or not ready", async () => {
    const { client } = fakeClient({ ...READY, providers: [{ provider: "codex", installed: false, version: null }] });
    render(<LocalizationTestProvider language="en"><ChatPage client={client} /></LocalizationTestProvider>);
    await waitFor(() => expect(screen.getByText("Codex CLI isn't on this computer. Install it and sign in to use it.")).toBeTruthy());
    const input = screen.getByLabelText("Ask about your records…");
    fireEvent.change(input, { target: { value: "hello" } });
    expect((screen.getByLabelText("Send") as HTMLButtonElement).disabled).toBe(true);
    expect((screen.getByRole("option", { name: "Drifty Cloud (coming soon)" }) as HTMLOptionElement).disabled).toBe(true);
  });
});

