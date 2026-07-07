// @vitest-environment jsdom

import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import {
  ProjectDiscoveryCard,
  type ProjectCandidate,
  type ProjectDiscoveryCardProps,
} from "./ProjectDiscoveryCard";

const CANDIDATES: readonly ProjectCandidate[] = [
  { id: "proj-1", name: "Drifty desktop", description: "Tauri shell, React UI, and tracker work." },
  { id: "proj-2", name: "Investor update", description: "Deck edits, email threads, and metrics docs." },
];

function makeProps(overrides: Partial<ProjectDiscoveryCardProps> = {}): ProjectDiscoveryCardProps {
  return {
    needsModel: false,
    candidates: [],
    onAccept: vi.fn(),
    onDismiss: vi.fn(),
    onConnectModel: vi.fn(),
    ...overrides,
  };
}

describe("ProjectDiscoveryCard", () => {
  it("invites connecting an analysis model when none is connected", () => {
    const onConnectModel = vi.fn();

    render(<ProjectDiscoveryCard {...makeProps({ needsModel: true, onConnectModel })} />);

    expect(screen.getByText("See your time grouped by project")).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: /Connect analysis model/i }));

    expect(onConnectModel).toHaveBeenCalledTimes(1);
  });

  it("lists noticed project candidates and accepts the chosen one", () => {
    const onAccept = vi.fn();

    render(<ProjectDiscoveryCard {...makeProps({ needsModel: false, candidates: CANDIDATES, onAccept })} />);

    expect(screen.getByText("Projects we noticed")).toBeTruthy();
    expect(screen.getByText("Drifty desktop")).toBeTruthy();
    expect(screen.getByText("Investor update")).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: "Add Investor update" }));

    expect(onAccept).toHaveBeenCalledTimes(1);
    expect(onAccept).toHaveBeenCalledWith(CANDIDATES[1]);
  });

  it("offers the optional Add all action when provided", () => {
    const onAcceptAll = vi.fn();

    render(<ProjectDiscoveryCard {...makeProps({ candidates: CANDIDATES, onAcceptAll })} />);

    fireEvent.click(screen.getByRole("button", { name: /^Add all$/i }));

    expect(onAcceptAll).toHaveBeenCalledTimes(1);
  });

  it("dismisses the card", () => {
    const onDismiss = vi.fn();

    render(<ProjectDiscoveryCard {...makeProps({ candidates: CANDIDATES, onDismiss })} />);

    fireEvent.click(screen.getByRole("button", { name: /Dismiss project discovery/i }));

    expect(onDismiss).toHaveBeenCalledTimes(1);
  });

  it("renders nothing when no model is needed and there are no candidates", () => {
    const { container } = render(
      <ProjectDiscoveryCard {...makeProps({ needsModel: false, candidates: [] })} />,
    );

    expect(container.firstChild).toBeNull();
  });
});
