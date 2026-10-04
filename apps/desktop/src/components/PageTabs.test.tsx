// @vitest-environment jsdom

import { fireEvent, render, screen } from "@testing-library/react";
import { useState } from "react";
import { describe, expect, it } from "vitest";
import { PageTabs } from "./PageTabs";

const TABS = [
  { id: "overview", label: "Overview" },
  { id: "projects", label: "Projects" },
  { id: "members", label: "Members" },
] as const;

function Harness({ panelId }: { readonly panelId?: string }) {
  const [active, setActive] = useState<(typeof TABS)[number]["id"]>("overview");
  return <PageTabs tabs={TABS} activeTab={active} onChange={setActive} ariaLabel="Views" idPrefix="demo" panelId={panelId} />;
}

describe("PageTabs", () => {
  it("moves selection and focus with arrow, Home, and End keys", () => {
    render(<Harness />);
    const overview = screen.getByRole("tab", { name: "Overview" });

    fireEvent.keyDown(overview, { key: "ArrowRight" });
    expect(screen.getByRole("tab", { name: "Projects" }).getAttribute("aria-selected")).toBe("true");
    expect(document.activeElement).toBe(screen.getByRole("tab", { name: "Projects" }));

    fireEvent.keyDown(document.activeElement as Element, { key: "End" });
    expect(document.activeElement).toBe(screen.getByRole("tab", { name: "Members" }));

    fireEvent.keyDown(document.activeElement as Element, { key: "ArrowRight" });
    expect(screen.getByRole("tab", { name: "Overview" }).getAttribute("aria-selected")).toBe("true");

    fireEvent.keyDown(document.activeElement as Element, { key: "ArrowLeft" });
    expect(screen.getByRole("tab", { name: "Members" }).getAttribute("aria-selected")).toBe("true");
    expect(screen.getAllByRole("tab").filter((tab) => tab.tabIndex === 0)).toHaveLength(1);
  });

  it("points every tab at one shared panel when the page has a single panel", () => {
    render(<Harness panelId="shared-panel" />);
    for (const tab of screen.getAllByRole("tab")) expect(tab.getAttribute("aria-controls")).toBe("shared-panel");
  });
});
