// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { useState } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { LocalizationTestProvider } from "../localization/LocalizationContext";
import { TeamRoster } from "./TeamRoster";
import type { TeamManagerAssignment } from "./teamSharingPolicy";
import type { TeamDirectoryMember, TeamGroup, TeamMember } from "./teamTypes";

const group = (id: string, name: string, parent: string | null): TeamGroup => ({ id, organization_id: "org", name, parent_group_id: parent, lead_display_name: null, member_count: 1 });
const GROUPS = [group("platform", "Platform", null), group("infra", "Infrastructure", "platform"), group("sales", "Sales", null)];
const person = (key: string, name: string, groupId: string | null, role: TeamMember["membership_role"] = "member"): { member: TeamMember; person: TeamDirectoryMember } => ({
  member: { member_key: key, display_name: name, role_label: "Member", membership_role: role, joined_at: "2026-06-02T09:00:00.000Z", is_self: role === "owner" },
  person: { member_key: key, display_name: name, role_label: "Member", membership_role: role, group_id: groupId, is_self: role === "owner", weekly_goal_seconds: null },
});
const PEOPLE = [person("me", "Minseok Park", null, "owner"), person("theo", "Theo Seo", "infra"), person("ana", "Ana Lima", "sales")];

function Harness({ onRemove, initial = [] }: { readonly onRemove: (key: string) => void; readonly initial?: readonly TeamManagerAssignment[] }) {
  const [managers, setManagers] = useState<readonly TeamManagerAssignment[]>(initial);
  return (
    <LocalizationTestProvider language="en">
      <TeamRoster
        members={PEOPLE.map((entry) => entry.member)}
        people={PEOPLE.map((entry) => entry.person)}
        groups={GROUPS}
        managers={managers}
        onManagersChange={setManagers}
        canRemove
        onRemove={onRemove}
        busy={false}
        loading={false}
      />
    </LocalizationTestProvider>
  );
}

const rowNames = () => screen.queryAllByRole("listitem").map((item) => item.textContent ?? "");

afterEach(cleanup);

describe("TeamRoster", () => {
  it("finds people by their division as well as their own team", () => {
    render(<Harness onRemove={() => undefined} />);
    fireEvent.change(screen.getByLabelText("Search names or teams"), { target: { value: "platform" } });
    expect(rowNames()).toHaveLength(1);
    expect(rowNames()[0]).toContain("Theo Seo");
    fireEvent.change(screen.getByLabelText("Search names or teams"), { target: { value: "nobody" } });
    expect(screen.getByText("No one matches “nobody”.")).toBeTruthy();
  });

  it("makes a member a manager from their row and lists them under the managers filter", () => {
    render(<Harness onRemove={() => undefined} />);
    fireEvent.click(screen.getByRole("button", { name: "Edit Ana Lima" }));
    fireEvent.click(screen.getByRole("radio", { name: "Team manager" }));
    const save = screen.getByRole("button", { name: "Save" }) as HTMLButtonElement;
    // Teams and access are both needed before a manager can be saved.
    expect(save.disabled).toBe(true);
    fireEvent.click(screen.getByRole("button", { name: "Sales" }));
    fireEvent.click(screen.getByRole("radio", { name: /^Team totals/ }));
    fireEvent.click(save);

    fireEvent.click(screen.getByRole("button", { name: "Team managers 1" }));
    expect(rowNames()).toHaveLength(1);
    expect(rowNames()[0]).toContain("Sales · Team totals");
  });

  it("moves someone to another team of the organization from their editor", () => {
    const onMemberGroupChange = vi.fn();
    render(
      <LocalizationTestProvider language="en">
        <TeamRoster
          members={PEOPLE.map((entry) => entry.member)}
          people={PEOPLE.map((entry) => entry.person)}
          groups={GROUPS}
          managers={[]}
          onManagersChange={() => undefined}
          canRemove
          onRemove={() => undefined}
          busy={false}
          loading={false}
          onMemberGroupChange={onMemberGroupChange}
        />
      </LocalizationTestProvider>,
    );
    fireEvent.click(screen.getByRole("button", { name: "Edit Ana Lima" }));
    const team = screen.getByRole("combobox", { name: "Belongs to" });
    expect(team.textContent).toContain("Sales");
    fireEvent.click(team);
    fireEvent.click(screen.getByRole("option", { name: "No team" }));
    fireEvent.click(screen.getByRole("button", { name: "Save" }));
    expect(onMemberGroupChange).toHaveBeenCalledWith("ana", null);
  });

  it("turns a manager back into a member", () => {
    render(<Harness onRemove={() => undefined} initial={[{ member_key: "theo", display_name: "Theo Seo", group_ids: ["platform"], access: "detail" }]} />);
    expect(screen.getByRole("button", { name: "Team managers 1" })).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Edit Theo Seo" }));
    fireEvent.click(screen.getByRole("radio", { name: "Member" }));
    fireEvent.click(screen.getByRole("button", { name: "Save" }));
    expect(screen.getByRole("button", { name: "Team managers 0" })).toBeTruthy();
  });

  it("asks the caller to confirm removing someone, keeping their editor open meanwhile", () => {
    const onRemove = vi.fn();
    render(<Harness onRemove={onRemove} />);
    fireEvent.click(screen.getByRole("button", { name: "Edit Ana Lima" }));
    fireEvent.click(screen.getByRole("button", { name: "Remove from team" }));
    expect(onRemove).toHaveBeenCalledWith("ana");
    expect(screen.getByRole("button", { name: "Remove from team" })).toBeTruthy();
  });

  it("offers no edit for the owner or yourself", () => {
    render(<Harness onRemove={() => undefined} />);
    expect(screen.queryByRole("button", { name: "Edit Minseok Park" })).toBeNull();
  });
});
