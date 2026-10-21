// @vitest-environment jsdom
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";

import { SettingsRowDescription } from "./SettingsRowDescription";

afterEach(cleanup);

describe("SettingsRowDescription", () => {
  it("shows the description alone until the row's action reports something", () => {
    const view = render(<SettingsRowDescription description="Starts Drifty when you log in." />);
    expect(screen.getByText("Starts Drifty when you log in.").getAttribute("aria-hidden")).toBeNull();
    expect(view.container.querySelector(".settings-row-description__notice")).toBeNull();
  });

  it("puts a notice in the description's place while keeping the description laid out for its height", () => {
    const view = render(<SettingsRowDescription description="Starts Drifty when you log in." notice="Could not change login items." noticeTitle="detail" />);
    const notice = screen.getByRole("alert");
    expect(notice.textContent).toBe("Could not change login items.");
    expect(notice.getAttribute("title")).toBe("detail");
    const held = view.container.querySelector(".settings-row-description > [data-hidden]");
    expect(held?.textContent).toBe("Starts Drifty when you log in.");
    expect(held?.getAttribute("aria-hidden")).toBe("true");
    // Both sit in the one description element, so the row gains no line.
    expect(view.container.firstElementChild?.children).toHaveLength(2);
  });
});

