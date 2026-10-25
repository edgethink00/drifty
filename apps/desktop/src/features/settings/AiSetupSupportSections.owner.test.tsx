// @vitest-environment jsdom
import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, expect, it, vi } from "vitest";
import { AiSetupSupportSections } from "./AiSetupSupportSections";
import { writeSuggestionStore } from "../classification/memorySuggestionStore";
import type * as LivingSoul from "../classification/livingSoul";

const { adoptMock } = vi.hoisted(() => ({ adoptMock: vi.fn() }));
vi.mock("../classification/livingSoul", async (importOriginal) => ({
  ...await importOriginal<typeof LivingSoul>(), adoptLivingSoulSuggestion: adoptMock,
}));

beforeEach(() => { localStorage.clear(); adoptMock.mockReset(); });

it.each([false, true])("ignores a late accepted document across an owner switch (return to A: %s)", async (returnToA) => {
  const actual = await vi.importActual<typeof LivingSoul>("../classification/livingSoul");
  await actual.synchronizeLivingSoulDeclaredContextForUser("owner-a");
  await actual.synchronizeLivingSoulDeclaredContextForUser("owner-b");
  const summary = "Paper drafts are work; short clips are a distraction.";
  const now = new Date().toISOString();
  writeSuggestionStore("owner-a", { version: 1, lastRunAt: now, retryAfter: null, declined: [], suggestions: [{
    id: "ambiguous:Aside|overleaf.com", kind: "ambiguous", summary, app: "Aside", domain: "overleaf.com",
    minutes: 240, days: 3, blocks: 6, windowStart: now, windowEnd: now, createdAt: now,
  }] });
  let finish!: () => Promise<void>;
  adoptMock.mockImplementation((input: Parameters<typeof actual.adoptLivingSoulSuggestion>[0]) => new Promise((resolve) => {
    finish = async () => { resolve(await actual.adoptLivingSoulSuggestion(input)); };
  }));
  const profile = { workDescription: "", workActivityOther: "", workActivities: [], workDomain: null, workDomainOther: "" };
  const props = {
    savedWorkProfile: profile, workProfileDraft: profile, workProfileMessage: null,
    workProfileSaving: false, memorySnapshotVersion: 0, memorySuggestionProvider: null,
    onSaveWorkProfile: async () => true, onWorkProfileDraftChange: vi.fn(), onResetWorkProfileDraft: vi.fn(),
  };
  const view = render(<AiSetupSupportSections {...props} workProfileUserId="owner-a" />);
  const add = await screen.findByRole("button", { name: "Add to Memory" });
  await waitFor(() => expect(add).not.toHaveProperty("disabled", true));
  fireEvent.click(add);
  await waitFor(() => expect(adoptMock).toHaveBeenCalledTimes(1));
  view.rerender(<AiSetupSupportSections {...props} workProfileUserId="owner-b" />);
  await screen.findByText("No learned patterns yet");
  if (returnToA) {
    view.rerender(<AiSetupSupportSections {...props} workProfileUserId="owner-a" />);
    await screen.findByText("No learned patterns yet");
  }
  await act(async () => { await finish(); });
  expect(view.container.querySelector(".memory-patterns")).toBeNull();
  expect(screen.getByText("No learned patterns yet")).toBeTruthy();
  // A's already-authorized write still finishes in A's file; it cannot
  // replace B's screen or apply to a later A view with a different generation.
  const a = await actual.readLivingSoulForUser("owner-a");
  const b = await actual.readLivingSoulForUser("owner-b");
  expect(a.state === "ready" && a.context.document.learned.ambiguities.map(row => row.summary)).toEqual([summary]);
  expect(b.state === "ready" && b.context.document.learned.ambiguities).toEqual([]);
});
