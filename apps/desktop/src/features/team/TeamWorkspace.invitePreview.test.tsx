// @vitest-environment jsdom
import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { LocalizationTestProvider } from "../localization/LocalizationContext";
import { TeamsBetaSurface } from "./TeamsBetaSurface";
import { useTeamPreviewController } from "./teamPreview";
import { buildTeamPreviewFixture } from "./teamPreviewScenarios";
import type { TeamInvitePreview, TeamResult } from "./teamTypes";
const mocks = vi.hoisted(() => ({ preview: vi.fn(), accept: vi.fn(), clear: vi.fn() }));
vi.mock("./teamInvitePreviewService", () => ({ previewTeamInvite: mocks.preview }));
const fixture = buildTeamPreviewFixture({ scenario: { scale: "team", viewer: "owner", sharing: "work_and_focus", scope: "member_focus", policy: "free" }, today: "2026-10-17", nowMs: Date.parse("2026-10-17T05:10:00Z"), nowMinuteOfDay: 850 });
const preview: TeamInvitePreview = {
  organizationId: "invited-team", organizationName: "Another team", roleLabel: "Member", policyVersion: "a".repeat(32),
  policy: { projects: "hourly", tasks: "member_daily", focus: "team", memberSummary: false }, trackingPolicy: "managed",
  schedule: { days: [1, 2], start_minute: 600, end_minute: 1020, timezone: "Asia/Seoul" },
};
function Harness() {
  const controller = useTeamPreviewController(fixture);
  return <LocalizationTestProvider language="en"><TeamsBetaSurface controller={{ ...controller, handleAcceptInvite: mocks.accept }}
    hasRequiredAccountAuth isPolicySignedIn isSupabaseConfigured startOfDayMinutes={0}
    user={{ id: "joiner", app_metadata: {}, user_metadata: {}, aud: "authenticated", created_at: "2026-10-17" }}
    teamSubView="dashboards" onTeamSubViewChange={vi.fn()} onAuthRequired={vi.fn()}
    pendingInvite={{ inviteKey: "DRFT-ABCD-2345", inviteCode: "DRFT-ABCD-2345" }} onPendingInviteClear={mocks.clear}
  /></LocalizationTestProvider>;
}
beforeEach(() => { mocks.preview.mockReset(); mocks.accept.mockReset(); mocks.clear.mockReset(); window.localStorage.clear(); });
afterEach(() => window.localStorage.clear());
it("opens a deep link for review and accepts only the invited team's reviewed version", async () => {
  let resolve!: (value: TeamResult<TeamInvitePreview>) => void;
  mocks.preview.mockReturnValue(new Promise((done) => { resolve = done; })); mocks.accept.mockResolvedValue(true);
  render(<Harness />); fireEvent.click(screen.getByRole("button", { name: "Join team" }));
  const dialog = screen.getByRole("dialog", { name: "Add a team" });
  const join = within(dialog).getByRole("button", { name: "Join with this sharing" });
  expect((join as HTMLButtonElement).disabled).toBe(true); expect(mocks.accept).not.toHaveBeenCalled();
  await waitFor(() => expect(mocks.preview).toHaveBeenCalledWith("DRFT-ABCD-2345"));
  await act(async () => resolve({ success: true, error: null, data: preview }));
  expect(within(dialog).getByText("Before you join Another team")).toBeTruthy();
  expect(within(dialog).getByText("10:00", { exact: false }).textContent).toContain("17:00");
  fireEvent.keyDown(dialog, { key: "Enter" }); expect(mocks.accept).not.toHaveBeenCalled(); fireEvent.click(join);
  await waitFor(() => expect(mocks.clear).toHaveBeenCalledTimes(1));
  expect(mocks.accept).toHaveBeenCalledWith({ inviteKey: "DRFT-ABCD-2345", expectedPolicyVersion: preview.policyVersion });
  await waitFor(() => expect(screen.queryByRole("dialog", { name: "Add a team" })).toBeNull());
});
it("retains a failed deep link and refreshes settings without silently accepting again", async () => {
  mocks.preview.mockResolvedValueOnce({ success: true, error: null, data: preview })
    .mockResolvedValue({ success: true, error: null, data: { ...preview, policyVersion: "b".repeat(32), policy: { ...preview.policy, focus: "off" } } });
  mocks.accept.mockResolvedValueOnce(false).mockResolvedValue(true);
  render(<Harness />); fireEvent.click(screen.getByRole("button", { name: "Join team" }));
  const dialog = screen.getByRole("dialog", { name: "Add a team" });
  await waitFor(() => expect(within(dialog).getByText("Before you join Another team")).toBeTruthy());
  fireEvent.click(within(dialog).getByRole("button", { name: "Join with this sharing" }));
  await waitFor(() => expect(mocks.preview).toHaveBeenCalledTimes(2));
  await waitFor(() => expect((within(dialog).getByRole("button", { name: "Join with this sharing" }) as HTMLButtonElement).disabled).toBe(false));
  expect(mocks.clear).not.toHaveBeenCalled(); expect(mocks.accept).toHaveBeenCalledTimes(1);
  fireEvent.click(within(dialog).getByRole("button", { name: "Join with this sharing" }));
  await waitFor(() => expect(mocks.accept).toHaveBeenLastCalledWith({ inviteKey: "DRFT-ABCD-2345", expectedPolicyVersion: "b".repeat(32) }));
});
