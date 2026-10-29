// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { useState } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { LocalizationTestProvider } from "../localization/LocalizationContext";
import { TeamInviteDialog, type TeamInviteDialogProps } from "./TeamInviteDialog";
import type { TeamEmailInviteSendOutcome } from "./useTeamInviteActions";

afterEach(cleanup);

function Harness(props: Partial<TeamInviteDialogProps> & { readonly onSend: TeamInviteDialogProps["onSend"] }) {
  const [chips, setChips] = useState<readonly string[]>(props.chips ?? []);
  return (
    <LocalizationTestProvider language="en">
      <TeamInviteDialog
        teamName="Sales Team"
        teams={[]}
        teamId={null}
        onTeamChange={vi.fn()}
        link={{ url: "https://drifty.so/team-invite?code=DRFT-ABCD-2345", code: "DRFT-ABCD-2345" }}
        linkState="ready"
        onRetryLink={vi.fn()}
        onCopy={vi.fn()}
        pending={[]}
        canCancel={() => true}
        onCancelInvite={vi.fn()}
        formatDay={(iso) => iso.slice(0, 10)}
        onSent={vi.fn()}
        onBusyChange={vi.fn()}
        onClose={vi.fn()}
        {...props}
        chips={chips}
        onChipsChange={setChips}
      />
    </LocalizationTestProvider>
  );
}

const field = () => screen.getByRole("textbox", { name: "Email addresses" });
const type = (value: string, key = "Enter") => {
  fireEvent.change(field(), { target: { value } });
  fireEvent.keyDown(field(), { key });
};
const sent = (...emails: string[]): TeamEmailInviteSendOutcome => ({ ok: true, results: emails.map((email) => ({ email, outcome: "sent" as const })) });

describe("team invite by email (owner decisions 2026-10-29)", () => {
  it("turns addresses into chips, marks only a committed bad one, and sends only on the button or ⌘/Ctrl+Enter", async () => {
    const onSend = vi.fn().mockResolvedValue(sent("hana@company.com"));
    render(<Harness onSend={onSend} />);
    fireEvent.change(field(), { target: { value: "hana" } });
    expect(screen.queryByText("Check this address")).toBeNull();
    fireEvent.change(field(), { target: { value: "hana@company.com" } });
    fireEvent.keyDown(field(), { key: "Enter" });
    type("not-an-address", ",");
    expect(screen.getByText("hana@company.com")).toBeTruthy();
    expect(screen.getByTitle("Check this address").textContent).toContain("not-an-address");
    expect(field().getAttribute("aria-invalid")).toBe("true");

    fireEvent.keyDown(field(), { key: "Enter" });
    expect(onSend).not.toHaveBeenCalled();
    expect(screen.getByRole("button", { name: /^Send invite/ })).toBeTruthy();

    await act(async () => { fireEvent.keyDown(field(), { key: "Enter", metaKey: true }); });
    expect(onSend).toHaveBeenCalledWith(["hana@company.com"]);
  });

  it("closes with the floating notice when everything went out", async () => {
    const onSent = vi.fn();
    const onClose = vi.fn();
    render(<Harness onSend={vi.fn().mockResolvedValue({ ok: true, results: [{ email: "hana@company.com", outcome: "sent" }, { email: "alex@company.com", outcome: "member" }] })} onSent={onSent} onClose={onClose} />);
    fireEvent.paste(field(), { clipboardData: { getData: () => "Hana Kim <hana@company.com>, alex@company.com" } });
    expect(screen.getByRole("button", { name: /^Send to 2/ })).toBeTruthy();
    await act(async () => { fireEvent.click(screen.getByRole("button", { name: /^Send to 2/ })); });
    expect(onSent).toHaveBeenCalledWith(["hana@company.com"], ["alex@company.com"]);
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("stays open with what still needs the user in the field and one line saying why", async () => {
    const onClose = vi.fn();
    const onSend = vi.fn().mockResolvedValue({ ok: true, results: [{ email: "hana@company.com", outcome: "sent" }, { email: "minji@company.com", outcome: "failed" }] });
    render(<Harness onSend={onSend} onClose={onClose} chips={["hana@company.com", "minji@company.com", "bad"]} />);
    await act(async () => { fireEvent.click(screen.getByRole("button", { name: /^Send to 2/ })); });
    expect(onClose).not.toHaveBeenCalled();
    expect(screen.queryByText("hana@company.com")).toBeNull();
    expect(screen.getByText("minji@company.com")).toBeTruthy();
    expect(screen.getByText("bad")).toBeTruthy();
    const note = screen.getByRole("status");
    expect(note.textContent).toContain("Sent to 1");
    expect(note.textContent).toContain("1 not sent");
    expect(note.textContent).toContain("Check the addresses in red (1)");
  });

  it("keeps the link a secondary path whose menu holds only the code", () => {
    const onCopy = vi.fn();
    const { rerender } = render(<Harness onSend={vi.fn()} link={null} linkState="creating" onCopy={onCopy} />);
    expect((screen.getByRole("button", { name: /Copy invite link|Making link/ }) as HTMLButtonElement).disabled).toBe(true);

    rerender(<Harness onSend={vi.fn()} onCopy={onCopy} />);
    fireEvent.click(screen.getByRole("button", { name: "Copy invite link" }));
    expect(onCopy).toHaveBeenCalledWith("https://drifty.so/team-invite?code=DRFT-ABCD-2345");
    fireEvent.click(screen.getByRole("button", { name: "Link options" }));
    const menu = screen.getByRole("menu", { name: "Link options" });
    expect(within(menu).getAllByRole("menuitem")).toHaveLength(1);
    fireEvent.click(within(menu).getByRole("menuitem", { name: /^Copy code/ }));
    expect(onCopy).toHaveBeenLastCalledWith("DRFT-ABCD-2345");
  });
});
