// @vitest-environment jsdom
import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { MainContentShell } from "./AppShell";

describe("MainContentShell", () => {
  it("announces tracker errors when they appear", () => {
    render(
      <MainContentShell
        activeTab="dashboard"
        loading={false}
        hasLoadedOnce
        error="Tracker connection failed"
      >
        <p>Dashboard content</p>
      </MainContentShell>,
    );

    expect(screen.getByRole("alert").textContent).toBe("Error: Tracker connection failed");
  });
});
