// @vitest-environment jsdom
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { ActionLabel } from "./ActionLabel";

describe("ActionLabel", () => {
  afterEach(cleanup);

  it("keeps the idle label as the accessible name while a spinner takes over", () => {
    render(<button type="button" aria-busy="true" disabled><ActionLabel busy>Unblock</ActionLabel></button>);
    const button = screen.getByRole("button", { name: "Unblock" });
    expect(button.querySelector(".action-label__spinner")).toBeTruthy();
    expect(button.querySelector(".action-label__live--quiet .action-label__idle")?.textContent).toBe("Unblock");
  });

  it("names the button after the progress label and reserves every other label", () => {
    render(
      <button type="button" aria-busy="true" disabled>
        <ActionLabel busy busyLabel="Saving…" reserve={["Confirm again"]}>Save changes</ActionLabel>
      </button>,
    );
    expect(screen.getByRole("button", { name: "Saving…" })).toBeTruthy();
    const reserved = Array.from(document.querySelectorAll(".action-label__size")).map((node) => node.textContent);
    expect(reserved).toEqual(["Save changes", "Confirm again", "Saving…"]);
    expect(document.querySelectorAll(".action-label__size[aria-hidden='true']")).toHaveLength(3);
  });

  it("shows only the idle label when idle", () => {
    render(<button type="button"><ActionLabel busy={false} busyLabel="Copying…">Copy</ActionLabel></button>);
    expect(screen.getByRole("button", { name: "Copy" })).toBeTruthy();
    expect(document.querySelector(".action-label__live")?.querySelector(".action-label__spinner")).toBeNull();
  });
});
