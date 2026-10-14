// @vitest-environment jsdom
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { ClassificationRule, ClassificationRuleCandidate } from "@drifty/domain";
import { trackerClient } from "../../lib/api/trackerClient";
import { LocalizationTestProvider } from "../localization/LocalizationContext";
import { ClassificationRuleComposer } from "./ClassificationRuleComposer";

afterEach(() => vi.restoreAllMocks());

const figma: ClassificationRuleCandidate = {
  id: "app:com.figma.Desktop", targetKind: "app", targetValue: "com.figma.Desktop", displayName: "Figma",
  appName: "Figma", bundleId: "com.figma.Desktop", category: "learning", productivity: "neutral", segmentCount: 4, totalSeconds: 4200,
};
const youtube: ClassificationRuleCandidate = {
  id: "site:youtube.com", targetKind: "site", targetValue: "youtube.com", displayName: "youtube.com",
  siteDomain: "youtube.com", category: "entertainment", productivity: "drift", segmentCount: 9, totalSeconds: 9000,
};

function renderComposer(rules: ClassificationRule[], onSaveRule = vi.fn().mockResolvedValue(true)) {
  vi.spyOn(trackerClient, "searchClassificationRuleCandidates").mockImplementation(async ({ targetKind }) => targetKind === "app" ? [figma] : [youtube]);
  const onSaved = vi.fn();
  render(
    <LocalizationTestProvider language="en">
      <ClassificationRuleComposer classificationRules={rules} appIcons={{}} appThemeColorOverrides={{}} categoryColorOverrides={{}}
        saving={false} onSaveRule={onSaveRule} onCancel={vi.fn()} onSaved={onSaved} />
    </LocalizationTestProvider>,
  );
  return { onSaveRule, onSaved };
}

describe("ClassificationRuleComposer", () => {
  it("chooses the first addable match on Enter, skipping one already in the list", async () => {
    const youtubeRule: ClassificationRule = { id: "site:youtube.com", targetKind: "site", targetValue: "youtube.com", matchScope: "surface",
      detailKind: null, detailValue: null, category: "entertainment", productivity: "drift", enabled: true, confidence: null };
    const { onSaveRule, onSaved } = renderComposer([youtubeRule]);
    const search = screen.getByRole("searchbox", { name: /Search for an app or site to classify/i });
    await screen.findByRole("button", { name: /Choose youtube\.com/i });

    fireEvent.keyDown(search, { key: "Enter" });
    fireEvent.click(await screen.findByRole("button", { name: /^Save classification for Figma$/ }));

    await waitFor(() => expect(onSaveRule).toHaveBeenCalledWith({ targetKind: "app", targetValue: "com.figma.Desktop", category: "learning", productivity: "neutral", enabled: true }));
    expect(onSaved).toHaveBeenCalledOnce();
  });

  it("will not save a page that already has its own classification", async () => {
    const pageRule: ClassificationRule = { id: "page", targetKind: "site", targetValue: "github.com", matchScope: "detail", detailKind: "siteUrl",
      detailValue: "https://github.com/drifty/app", category: "workspace", productivity: "focus", enabled: true, confidence: null };
    const { onSaveRule } = renderComposer([pageRule]);

    fireEvent.change(screen.getByRole("searchbox", { name: /Search for an app or site to classify/i }), { target: { value: "github.com/drifty/app" } });
    fireEvent.click(await screen.findByRole("button", { name: /^Use github\.com$/ }));
    fireEvent.click(screen.getByRole("radio", { name: /^This page only$/ }));

    expect(screen.getByRole("status").textContent).toBe("This is already in your list. Edit it there.");
    const save = screen.getByRole("button", { name: /^Save classification for https:\/\/github\.com\/drifty\/app$/ }) as HTMLButtonElement;
    expect(save.disabled).toBe(true);
    // The whole site is still free to classify.
    fireEvent.click(screen.getByRole("radio", { name: /^Whole website$/ }));
    expect((screen.getByRole("button", { name: /^Save classification for github\.com$/ }) as HTMLButtonElement).disabled).toBe(false);
    expect(onSaveRule).not.toHaveBeenCalled();
  });
});
