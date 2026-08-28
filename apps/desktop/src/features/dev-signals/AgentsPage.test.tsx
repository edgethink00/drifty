// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { AgentsDaySource } from "./agentsPageModel";
import { useAgentsData } from "./useAgentsData";
import { AgentsPage } from "./AgentsPage";

vi.mock("./useAgentsData", () => ({
  useAgentsData: vi.fn(),
}));

const source: AgentsDaySource = {
  day: "2026-08-28",
  attention: [[60, 90]],
  turns: [[60, 120, "codex", "drifty_mac", "gpt-5", 1_000]],
  commits: [[110, 12, 3, 2, "abc123", "drifty_mac"]],
  sessions: 1,
  tokens: 1_000,
};

function renderAgentsPage(overrides: Partial<Parameters<typeof AgentsPage>[0]> = {}) {
  const props: Parameters<typeof AgentsPage>[0] = {
    flowIntervalMinutes: 3,
    onFlowIntervalChange: vi.fn(),
    onSelectDay: vi.fn(),
    selectedDay: "2026-08-28",
    startOfWeek: "monday",
    todayDay: "2026-08-28",
    ...overrides,
  };
  render(<AgentsPage {...props} />);
  return props;
}

describe("AgentsPage shared dashboard controls", () => {
  beforeEach(() => {
    vi.mocked(useAgentsData).mockReturnValue({ days: [source], loading: false, live: true });
  });

  afterEach(() => {
    cleanup();
    vi.clearAllMocks();
  });

  it("navigates Day and Week ranges with the shared date navigator", () => {
    const props = renderAgentsPage();

    expect(screen.getByRole("button", { name: "Show previous agents day" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Show next agents day" }).hasAttribute("disabled")).toBe(true);
    expect(screen.getByRole("button", { name: "Today" }).hasAttribute("disabled")).toBe(true);

    fireEvent.click(screen.getByRole("button", { name: "Show previous agents day" }));
    expect(props.onSelectDay).toHaveBeenCalledWith("2026-08-27");

    fireEvent.click(screen.getByRole("button", { name: "Week" }));
    expect(screen.getByRole("button", { name: "Show previous agents week" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "This Week" }).hasAttribute("disabled")).toBe(true);

    fireEvent.click(screen.getByRole("button", { name: "Show previous agents week" }));
    expect(props.onSelectDay).toHaveBeenCalledWith("2026-08-21");
  });

  it("uses the same persisted Flow detail control as Your Day", () => {
    const onFlowIntervalChange = vi.fn();
    renderAgentsPage({ flowIntervalMinutes: 3, onFlowIntervalChange });

    expect(screen.queryByRole("button", { name: "3m" })).toBeNull();
    fireEvent.click(screen.getByRole("combobox", { name: "Flow detail: 3m" }));
    fireEvent.click(screen.getByRole("option", { name: "6m" }));

    expect(onFlowIntervalChange).toHaveBeenCalledWith(6);
  });
});
