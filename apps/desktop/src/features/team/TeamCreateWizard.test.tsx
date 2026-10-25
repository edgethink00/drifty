// @vitest-environment jsdom

import { fireEvent, render, screen } from "@testing-library/react";
import { useState } from "react";
import { describe, expect, it, vi } from "vitest";

import { LocalizationTestProvider } from "../localization/LocalizationContext";
import { TeamCreateWizard } from "./TeamCreateWizard";
import type { TeamCreateWithPolicyInput } from "./useTeamController";

function Harness({ onCreate }: { readonly onCreate: (input: TeamCreateWithPolicyInput) => Promise<boolean> }) {
  const [name, setName] = useState("");
  return (
    <LocalizationTestProvider language="en">
      <TeamCreateWizard
        name={name}
        onNameChange={setName}
        busy={false}
        error={null}
        invite={{ url: "https://drifty.so/team-invite?code=ABC", code: "ABC" }}
        copiedKey={null}
        previewNote={false}
        onCopy={() => undefined}
        onCancel={() => undefined}
        onCreate={onCreate}
        onDone={() => undefined}
      />
    </LocalizationTestProvider>
  );
}

const next = () => screen.getByRole("button", { name: "Next" });

describe("TeamCreateWizard", () => {
  it("starts sharing on the default, takes the work-record and focus switches, then creates the team", async () => {
    const onCreate = vi.fn(async () => true);
    render(<Harness onCreate={onCreate} />);

    expect((next() as HTMLButtonElement).disabled).toBe(true);
    fireEvent.change(screen.getByLabelText("Team name"), { target: { value: "Product" } });
    fireEvent.click(next());

    // A new team starts on the default: each person's work records by time of day, focus not shared, members see their own records.
    const toggle = (name: string) => screen.getByRole("switch", { name });
    expect(toggle("Each person's work records").getAttribute("aria-checked")).toBe("true");
    expect(toggle("Times of day").getAttribute("aria-checked")).toBe("true");
    expect(toggle("Focus time").getAttribute("aria-checked")).toBe("false");
    expect(toggle("Team totals for members").getAttribute("aria-checked")).toBe("false");
    expect((next() as HTMLButtonElement).disabled).toBe(false);
    // The two work-record switches sit side by side: each person's records off takes times of day with it,
    // and times of day on brings each person's records back.
    fireEvent.click(toggle("Each person's work records"));
    expect(toggle("Times of day").getAttribute("aria-checked")).toBe("false");
    fireEvent.click(toggle("Times of day"));
    expect(toggle("Each person's work records").getAttribute("aria-checked")).toBe("true");
    // Without times of day each person's daily totals remain; focus, once shared, follows their detail.
    fireEvent.click(toggle("Times of day"));
    fireEvent.click(toggle("Focus time"));
    expect(toggle("Times of day").getAttribute("aria-checked")).toBe("false");
    expect(toggle("Focus time").getAttribute("aria-checked")).toBe("true");
    fireEvent.click(next());

    // Hours: pausing has no default either.
    expect((next() as HTMLButtonElement).disabled).toBe(true);
    fireEvent.click(screen.getByRole("combobox", { name: "Pausing" }));
    fireEvent.click(screen.getByRole("option", { name: /^No pausing in team hours/ }));
    fireEvent.click(next());

    expect(screen.getByText("Work records").closest("div")?.textContent).toContain("Daily totals");
    expect(screen.getByText("Focus time").closest("div")?.textContent).toContain("Shared");
    fireEvent.click(screen.getByRole("button", { name: "Create team" }));
    expect(await screen.findByText("New team created · Product")).toBeTruthy();
    expect(onCreate).toHaveBeenCalledWith({
      organizationName: "Product",
      policy: { projects: "member_daily", tasks: "member_daily", focus: "member_daily", memberSummary: false },
      window: expect.objectContaining({ days: [1, 2, 3, 4, 5], start_minute: 540, end_minute: 1080 }),
      trackingPolicy: "managed",
    });
  });
});
