// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { FriendInvite, FriendInviteResult } from "../billing/billingService";
import type { FriendInviteCodeEntry } from "./FriendInviteCard";
import { LocalizationTestProvider } from "../localization/LocalizationContext";
import { buildFriendInviteUrl, FriendInviteCard } from "./FriendInviteCard";

const { captureMock } = vi.hoisted(() => ({ captureMock: vi.fn() }));
vi.mock("../../lib/analytics/posthogClient", () => ({ capturePostHogEvent: captureMock }));

const INVITE: FriendInvite = {
  code: "DRIFTY-3F9A2C7B1D",
  codeEntryUntil: "2099-01-01T00:00:00.000Z",
  durationDays: 30,
  claimedCount: 0,
  maxClaims: 10,
  expiresAt: "2027-10-08T00:00:00.000Z",
  status: "active",
  claims: [],
};

let accountSeq = 0;
function freshAccount(): string {
  accountSeq += 1;
  return "account-" + accountSeq + "@example.com";
}

function renderCard(
  result: FriendInviteResult,
  options: {
    readonly language?: "en" | "ko";
    readonly copyText?: (text: string) => Promise<void>;
    readonly accountKey?: string;
    readonly codeEntry?: FriendInviteCodeEntry | null;
  } = {},
) {
  const loadInvite = vi.fn(async () => result);
  const view = render(
    <LocalizationTestProvider language={options.language ?? "en"}>
      <FriendInviteCard
        accountKey={options.accountKey ?? freshAccount()}
        loadInvite={loadInvite}
        copyText={options.copyText}
        codeEntry={options.codeEntry}
      />
    </LocalizationTestProvider>,
  );
  return { ...view, loadInvite };
}

describe("FriendInviteCard", () => {
  afterEach(() => {
    cleanup();
    captureMock.mockReset();
  });

  it.each([{ kind: "disabled" }, { kind: "unavailable" }] as const)("shows nothing when the invite read is %o", async (result) => {
    const { container, loadInvite } = renderCard(result);
    await waitFor(() => expect(loadInvite).toHaveBeenCalledTimes(1));
    expect(container.innerHTML).toBe("");
  });

  it("presents the gift, the steps and the gift-page link in the display language", async () => {
    renderCard({ kind: "ready", invite: INVITE }, { language: "ko" });

    expect(await screen.findByRole("heading", { name: "친구에게 drifty Pro 30일을 선물하세요" })).toBeTruthy();
    expect(screen.getByRole("img", { name: "drifty Pro 30일 선물 이용권, Cloud AI 포함." })).toBeTruthy();
    const steps = within(screen.getByRole("list")).getAllByRole("listitem").map((item) => item.textContent);
    expect(steps).toEqual([
      "초대 링크를 친구에게 보내요",
      "친구가 가입하면 카드 없이 Pro 30일을 받아요",
      "링크 하나로 친구 10명까지 선물할 수 있어요",
    ]);
    const link = screen.getByRole("textbox", { name: "내 초대 링크" }) as HTMLInputElement;
    expect(link.value).toBe("https://drifty.so/ko/gift/#pass=DRIFTY-3F9A2C7B1D");
    expect(link.readOnly).toBe(true);
    expect(screen.getByText("초대 링크는 2027년 10월 8일까지 쓸 수 있어요.")).toBeTruthy();
    expect(buildFriendInviteUrl("DRIFTY-3F9A2C7B1D", "en")).toBe("https://drifty.so/gift/#pass=DRIFTY-3F9A2C7B1D");
  });

  it("copies the link and records only the action", async () => {
    const copyText = vi.fn(async () => undefined);
    renderCard({ kind: "ready", invite: INVITE }, { copyText });

    fireEvent.click(await screen.findByRole("button", { name: "Copy link" }));

    await waitFor(() => expect(screen.getByRole("button", { name: "Copied" })).toBeTruthy());
    expect(copyText).toHaveBeenCalledWith("https://drifty.so/gift/#pass=DRIFTY-3F9A2C7B1D");
    expect(captureMock).toHaveBeenCalledWith("billing_action", { action: "friend_invite_copied", result: "success" });
    expect(JSON.stringify(captureMock.mock.calls)).not.toContain("DRIFTY-");
  });

  it("leaves the link selected for manual copy when the clipboard refuses", async () => {
    const copyText = vi.fn(async () => {
      throw new Error("denied");
    });
    renderCard({ kind: "ready", invite: INVITE }, { copyText });

    fireEvent.click(await screen.findByRole("button", { name: "Copy link" }));

    expect((await screen.findByRole("alert")).textContent).toBe("Couldn't copy. Select the link and copy it.");
    expect(document.activeElement).toBe(screen.getByRole("textbox", { name: "Your invite link" }));
    expect(captureMock).toHaveBeenCalledWith("billing_action", { action: "friend_invite_copied", result: "error" });
  });

  it("lists claimed gifts by date only, with progress toward the cap", async () => {
    renderCard({
      kind: "ready",
      invite: {
        ...INVITE,
        claimedCount: 2,
        claims: [{ claimedAt: "2026-10-06T03:00:00.000Z" }, { claimedAt: "2026-10-02T03:00:00.000Z" }],
      },
    });

    fireEvent.click(await screen.findByRole("tab", { name: "Friends (2)" }));

    const panel = screen.getByRole("tabpanel");
    const meter = within(panel).getByRole("meter", { name: "Gifts claimed" });
    expect([meter.getAttribute("aria-valuenow"), meter.getAttribute("aria-valuemax")]).toEqual(["2", "10"]);
    const rows = within(panel).getAllByRole("listitem").map((item) => item.textContent);
    expect(rows).toEqual(["2Friend 2Claimed October 6, 2026", "1Friend 1Claimed October 2, 2026"]);
    expect(within(panel).queryByText(/@/)).toBeNull();
  });

  it("explains an empty Friends tab", async () => {
    renderCard({ kind: "ready", invite: INVITE });
    fireEvent.click(await screen.findByRole("tab", { name: "Friends (0)" }));
    expect(screen.getByText("No friends yet")).toBeTruthy();
  });

  it.each([
    [{ status: "exhausted", claimedCount: 10 }, "All 10 gifts have been claimed."],
    [{ status: "expired" }, "This invite link has expired."],
  ] as const)("replaces the link with the reason sharing closed for %o", async (patch, message) => {
    renderCard({ kind: "ready", invite: { ...INVITE, ...patch } });
    expect(await screen.findByText(message)).toBeTruthy();
    expect(screen.queryByRole("textbox")).toBeNull();
    expect(screen.queryByRole("button", { name: "Copy link" })).toBeNull();
    expect(screen.queryByText(/Your link works until/)).toBeNull();
  });

  it("offers code entry as a tab only where a code can be redeemed", async () => {
    renderCard({ kind: "ready", invite: INVITE }, { codeEntry: null });
    await screen.findByRole("textbox");
    expect(screen.queryByRole("tab", { name: "Enter code" })).toBeNull();
  });

  it("redeems a friend's code through the shared Promo code control", async () => {
    const onRedeem = vi.fn();
    renderCard({ kind: "ready", invite: INVITE }, {
      codeEntry: {
        activePromotionEndsAt: null,
        disabled: false,
        isSignedIn: true,
        loading: false,
        redemption: null,
        errorCode: null,
        onRedeem,
      },
    });

    fireEvent.click(await screen.findByRole("tab", { name: "Enter code" }));
    const panel = screen.getByRole("tabpanel");
    const field = within(panel).getByRole("textbox", { name: "Drifty promo code" }) as HTMLInputElement;
    expect(field.placeholder).toBe("DRIFTY-XXXXXXXXXX");
    expect(within(panel).getByText("Got a code from a friend? Enter it within 14 days of signing up to use Pro without a card.")).toBeTruthy();
    fireEvent.change(field, { target: { value: " drifty‑3f9a2c7b1d " } });
    fireEvent.click(within(panel).getByRole("button", { name: "Apply" }));

    expect(onRedeem).toHaveBeenCalledWith("DRIFTY-3F9A2C7B1D");
    expect(screen.queryByText(/Your link works until/)).toBeNull();
  });

  it("closes code entry once the account is past its 14-day new-account window", async () => {
    const codeEntry: FriendInviteCodeEntry = {
      activePromotionEndsAt: null,
      disabled: false,
      isSignedIn: true,
      loading: false,
      redemption: null,
      errorCode: null,
      onRedeem: vi.fn(),
    };
    renderCard({ kind: "ready", invite: { ...INVITE, codeEntryUntil: "2020-01-01T00:00:00.000Z" } }, { codeEntry });
    expect(await screen.findByRole("tab", { name: "Invite" })).toBeTruthy();
    expect(screen.queryByRole("tab", { name: "Enter code" })).toBeNull();
    cleanup();

    renderCard({ kind: "ready", invite: { ...INVITE, codeEntryUntil: null } }, { codeEntry });
    expect(await screen.findByRole("tab", { name: "Invite" })).toBeTruthy();
    expect(screen.queryByRole("tab", { name: "Enter code" })).toBeNull();
  });

  it("never shows one account's cached invite to another account", async () => {
    const first = renderCard({ kind: "ready", invite: INVITE }, { accountKey: "first@example.com" });
    expect(await screen.findByRole("textbox")).toBeTruthy();
    first.unmount();

    const second = renderCard({ kind: "disabled" }, { accountKey: "second@example.com" });
    expect(screen.queryByRole("textbox")).toBeNull();
    await waitFor(() => expect(second.loadInvite).toHaveBeenCalledTimes(1));
    expect(second.container.innerHTML).toBe("");

    // The first account's invite stays cached through a transient failure.
    second.unmount();
    renderCard({ kind: "unavailable" }, { accountKey: "first@example.com" });
    expect(screen.getByRole("textbox")).toBeTruthy();
    await act(async () => undefined);
    expect(screen.getByRole("textbox")).toBeTruthy();
  });
});
