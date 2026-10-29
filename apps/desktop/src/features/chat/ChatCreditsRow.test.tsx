// @vitest-environment jsdom
import { act, cleanup, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { LocalizationTestProvider } from "../localization/LocalizationContext";
import { ChatCreditsRow, resetChatCreditsRowForTests } from "./ChatCreditsRow";

afterEach(() => {
  cleanup();
  resetChatCreditsRowForTests();
  window.localStorage.clear();
});

type Reply = { status: number; data: unknown };

const PRO_STATUS = {
  available: true, plan: "active", defaultModel: "sonnet",
  credits: { remaining: 742, granted: 1000, renewsAt: "2026-11-15T09:00:00.000Z" }, models: [],
};

const never = () => vi.fn(() => new Promise<Reply>(() => undefined));

function renderRow(invoke: () => Promise<Reply>, props: { accountKey?: string; expectCredits?: boolean; language?: "en" | "ko" } = {}) {
  return render(
    <LocalizationTestProvider language={props.language ?? "en"}>
      <ChatCreditsRow invoke={invoke} accountKey={props.accountKey ?? null} expectCredits={props.expectCredits ?? true} />
    </LocalizationTestProvider>,
  );
}

describe("Drifty Cloud credits in Settings › Account", () => {
  it("shows what is left of the period's credits and when they refill", async () => {
    renderRow(vi.fn(async () => ({ status: 200, data: PRO_STATUS })), { language: "ko" });
    await waitFor(() => expect(screen.getByText("742 / 1,000 남음")).toBeTruthy());
    expect(screen.getByText("11월 15일에 1,000크레딧으로 다시 채워져요.")).toBeTruthy();
    expect(screen.getByRole("meter", { name: "Drifty Cloud 크레딧" }).getAttribute("aria-valuenow")).toBe("742");
  });

  it("says a trial's credits do not refill instead of explaining prices", async () => {
    renderRow(vi.fn(async () => ({ status: 200, data: {
      available: true, plan: "trialing", defaultModel: "sonnet",
      credits: { remaining: 250, granted: 250, renewsAt: null }, models: [],
    } })));
    await waitFor(() => expect(screen.getByText("250 / 250 left")).toBeTruthy());
    expect(screen.getByText("Included with your trial; they don't refill.")).toBeTruthy();
    expect(screen.queryByText(/Sonnet/)).toBeNull();
  });

  it("explains that Cloud chat comes with a trial or Pro on a free plan", async () => {
    renderRow(vi.fn(async () => ({ status: 200, data: { available: false, plan: "locked", credits: { remaining: 0, granted: 0, renewsAt: null }, models: [] } })), { expectCredits: false });
    await waitFor(() => expect(screen.getByText("Drifty Cloud chat comes with a trial or Pro.")).toBeTruthy());
    expect(screen.queryByRole("meter")).toBeNull();
  });

  it("keeps its final shape during the first read, without a checking message", async () => {
    let answer: (value: Reply) => void = () => undefined;
    const view = renderRow(vi.fn(() => new Promise<Reply>((resolve) => { answer = resolve; })));
    const row = view.container.querySelector(".chat-credits-row")!;
    expect(row.getAttribute("aria-busy")).toBe("true");
    expect(row.querySelector(".chat-credits-row__bar")).not.toBeNull();
    expect(screen.queryByText(/Checking/)).toBeNull();
    await act(async () => answer({ status: 200, data: PRO_STATUS }));
    expect(screen.getByText("742 / 1,000 left")).toBeTruthy();
    expect(row.getAttribute("aria-busy")).toBeNull();
  });

  it("opens with the account's last read, also after the app restarts, and only for that account", async () => {
    const first = renderRow(vi.fn(async () => ({ status: 200, data: PRO_STATUS })), { accountKey: "user-1" });
    await waitFor(() => expect(screen.getByText("742 / 1,000 left")).toBeTruthy());
    first.unmount();

    // Back in Account within the same session.
    const pending = never();
    const again = renderRow(pending, { accountKey: "user-1" });
    expect(screen.getByText("742 / 1,000 left")).toBeTruthy();
    expect(pending).toHaveBeenCalledTimes(1);
    again.unmount();

    // A relaunch starts with nothing in memory; the read kept on this computer is used.
    resetChatCreditsRowForTests();
    const relaunched = renderRow(never(), { accountKey: "user-1" });
    expect(screen.getByText("742 / 1,000 left")).toBeTruthy();
    expect(relaunched.container.querySelector(".chat-credits-row")!.getAttribute("aria-busy")).toBeNull();
    relaunched.unmount();

    renderRow(never(), { accountKey: "user-2" });
    expect(screen.queryByText("742 / 1,000 left")).toBeNull();
  });

  it("keeps the last numbers when Drifty Cloud cannot be reached, and replaces them with a fresh read", async () => {
    const seed = renderRow(vi.fn(async () => ({ status: 200, data: PRO_STATUS })), { accountKey: "user-1" });
    await waitFor(() => expect(screen.getByText("742 / 1,000 left")).toBeTruthy());
    seed.unmount();

    const offline = renderRow(vi.fn(async () => { throw new Error("offline"); }), { accountKey: "user-1" });
    await act(async () => undefined);
    expect(screen.getByText("742 / 1,000 left")).toBeTruthy();
    expect(screen.queryByText("Drifty Cloud can't be reached right now.")).toBeNull();
    offline.unmount();

    renderRow(vi.fn(async () => ({ status: 200, data: { ...PRO_STATUS, credits: { ...PRO_STATUS.credits, remaining: 730 } } })), { accountKey: "user-1" });
    await waitFor(() => expect(screen.getByText("730 / 1,000 left")).toBeTruthy());
  });
});
