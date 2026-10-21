// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import type { ActivitySegment, ClassificationRule } from "@drifty/domain";
import { trackerClient } from "../../lib/api/trackerClient";
import { ClassificationSavedRulesList } from "./ClassificationSavedRulesList";
import { ClassificationRulesManager } from "./ClassificationRulesManager";

const rule: ClassificationRule = { id: "existing", targetKind: "site", targetValue: "example.com", matchScope: "detail", detailKind: "siteUrl", detailValue: "https://example.com/course", category: "learning", productivity: "focus", enabled: false, confidence: 0.9 };
function setup(rules: ClassificationRule[] = [rule], options: { readonly hasError?: boolean; readonly segments?: readonly ActivitySegment[] } = {}) {
  const onSaveRule = vi.fn(async () => true);
  const onDeleteClassificationRule = vi.fn();
  const onToggleClassificationRule = vi.fn();
  const onLoadClassificationRules = vi.fn();
  render(<ClassificationSavedRulesList appIcons={{}} appThemeColorOverrides={{}} categoryColorOverrides={{}} hasError={options.hasError ?? false} saving={false} classificationRuleDeletingId={null} classificationRuleSegments={options.segments ?? []} classificationRules={rules} classificationRulesLoading={false} onLoadClassificationRules={onLoadClassificationRules} onSaveRule={onSaveRule} onDeleteClassificationRule={onDeleteClassificationRule} onToggleClassificationRule={onToggleClassificationRule} />);
  return { onSaveRule, onDeleteClassificationRule, onToggleClassificationRule, onLoadClassificationRules };
}
function chooseFromOptions(target: string, item: "Edit" | "Remove") {
  fireEvent.click(screen.getByRole("button", { name: "Options for " + target }));
  fireEvent.click(screen.getByRole("menuitem", { name: item }));
}
afterEach(cleanup);
afterEach(() => vi.restoreAllMocks());
describe("saved classification management", () => {
  it("puts a save result in the card's intro line instead of a box above the card", () => {
    vi.useFakeTimers();
    const props = {
      appIcons: {}, appThemeColorOverrides: {}, categoryColorOverrides: {}, classificationRuleDeletingId: null,
      classificationRuleSavingKind: null, classificationRuleSegments: [], classificationRules: [rule], classificationRulesLoading: false,
      onSaveRule: vi.fn(async () => true), onDeleteClassificationRule: vi.fn(), onLoadClassificationRules: vi.fn(), onToggleClassificationRule: vi.fn(),
    };
    const view = render(<ClassificationRulesManager {...props} classificationRuleApplyResult={null} classificationRuleMessage={null} classificationRulesError={null} />);
    const line = view.container.querySelector(".classification-rule-list-intro__line") as HTMLElement;
    const live = line.querySelector('[role="status"]') as HTMLElement;
    expect(live.textContent).toBe("");

    view.rerender(<ClassificationRulesManager {...props} classificationRuleApplyResult={null} classificationRuleMessage="Classification saved and applied." classificationRulesError={null} />);
    // The result shares the intro's grid cell inside the card; the intro stays
    // laid out invisibly, so the rules below keep their place.
    expect(live.textContent).toBe("Classification saved and applied.");
    expect(line.querySelector(".classification-rules-manager__intro")?.getAttribute("aria-hidden")).toBe("true");
    expect(view.container.querySelector(".classification-rule-saved-block > .classification-rules-manager__notice")).toBeNull();
    // A result hands the intro and its Help link back after a while.
    act(() => { vi.advanceTimersByTime(6000); });
    expect(live.textContent).toBe("");
    expect(line.querySelector(".classification-rules-manager__intro")?.getAttribute("aria-hidden")).toBeNull();

    // A failure stays until the next action replaces it.
    view.rerender(<ClassificationRulesManager {...props} classificationRuleApplyResult={null} classificationRuleMessage={null} classificationRulesError="database is locked" />);
    act(() => { vi.advanceTimersByTime(6000); });
    expect(live.textContent).toContain("database is locked");
    vi.useRealTimers();
  });
  it("keeps an empty list to its message, without a zero count or the one-time edit note", () => {
    setup([]);
    expect(screen.getByText("No ongoing classifications yet")).toBeTruthy();
    expect(screen.queryByText("0 classifications")).toBeNull();
    expect(screen.getByText(/^Always applied, ahead of AI\. Saved only on this device\.$/)).toBeTruthy();
    expect(screen.queryByText(/One-time edits are not listed/)).toBeNull();
  });
  it("edits a legacy exact-page choice without changing its match or disabled state", async () => {
    const { onSaveRule } = setup();
    chooseFromOptions("https://example.com/course", "Edit");
    fireEvent.click(screen.getByRole("combobox", { name: "Category" }));
    fireEvent.click(screen.getByRole("option", { name: "Communication" }));
    fireEvent.click(screen.getByRole("button", { name: "Save changes" }));
    await waitFor(() => expect(onSaveRule).toHaveBeenCalledWith({ targetKind: "site", targetValue: "example.com", matchScope: "detail", detailKind: "siteUrl", detailValue: "https://example.com/course", category: "communication", productivity: "focus", enabled: false, confidence: 0.9 }));
    await waitFor(() => expect(screen.queryByRole("button", { name: "Save changes" })).toBeNull());
  });
  it("retains edits when saving fails so the user can retry", async () => {
    const { onSaveRule } = setup();
    onSaveRule.mockResolvedValueOnce(false);
    chooseFromOptions("https://example.com/course", "Edit");
    fireEvent.click(screen.getByRole("combobox", { name: "Category" }));
    fireEvent.click(screen.getByRole("option", { name: "Music" }));
    fireEvent.click(screen.getByRole("button", { name: "Save changes" }));
    await waitFor(() => expect(onSaveRule).toHaveBeenCalled());
    expect(screen.getByRole("combobox", { name: "Category" }).textContent).toContain("Music");
    expect(screen.getByRole("button", { name: "Save changes" })).toBeTruthy();
  });
  it("separates turning on, cancellation, and confirmed removal", () => {
    const { onDeleteClassificationRule, onToggleClassificationRule } = setup();
    fireEvent.click(screen.getByRole("switch"));
    expect(onToggleClassificationRule).toHaveBeenCalledWith(rule, true);
    chooseFromOptions("https://example.com/course", "Remove");
    expect(onDeleteClassificationRule).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
    expect(onDeleteClassificationRule).not.toHaveBeenCalled();
    chooseFromOptions("https://example.com/course", "Remove");
    fireEvent.click(screen.getByRole("button", { name: "Remove classification" }));
    expect(onDeleteClassificationRule).toHaveBeenCalledWith(rule);
  });
  it("closes the options menu on Escape and returns focus to its trigger", () => {
    setup();
    const trigger = screen.getByRole("button", { name: "Options for https://example.com/course" });
    fireEvent.click(trigger);
    expect(trigger.getAttribute("aria-expanded")).toBe("true");
    fireEvent.keyDown(window, { key: "Escape" });
    expect(trigger.getAttribute("aria-expanded")).toBe("false");
    expect(document.activeElement).toBe(trigger);
  });
  it("names the matched page once, with its scope instead of a repeated URL", () => {
    const segment = { id: "seg", appName: "Safari", siteDomain: "example.com", siteUrl: "https://example.com/course", siteTitle: "Intro course" } as ActivitySegment;
    setup([rule], { segments: [segment] });
    const card = screen.getByRole("article");
    expect(card.textContent).toContain("example.com");
    expect(card.textContent).toContain("/course");
    expect(card.textContent).toContain("Intro course");
    expect(card.textContent).toContain("Learning · Focus · This page only");
    expect(card.textContent).not.toContain("https://");
    expect(card.textContent).not.toContain("URL:");
    expect(card.textContent).not.toMatch(/\bOff\b/);
  });
  it("shows a recorded app name and keeps the bundle ID out of the row text", () => {
    const appRule: ClassificationRule = { id: "slack", targetKind: "app", targetValue: "com.tinyspeck.slackmacgap", matchScope: "surface", detailKind: null, detailValue: null, category: "communication", productivity: "neutral", enabled: true, confidence: 1 };
    const segment = { id: "seg", appName: "Slack", bundleId: "com.tinyspeck.slackmacgap" } as ActivitySegment;
    setup([appRule], { segments: [segment] });
    const target = screen.getByText("Slack").closest("p");
    expect(target?.textContent).toBe("Slack");
    expect(target?.getAttribute("title")).toBe("Slack (com.tinyspeck.slackmacgap)");
    expect(screen.getByRole("article").textContent).toContain("Communication · Neutral · Whole app");
  });
  it("offers a retry only when loading failed, with no standing refresh control", () => {
    setup();
    expect(screen.queryByRole("button", { name: "Refresh" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Retry" })).toBeNull();
    cleanup();
    const { onLoadClassificationRules } = setup([rule], { hasError: true });
    fireEvent.click(screen.getByRole("button", { name: "Retry" }));
    expect(onLoadClassificationRules).toHaveBeenCalledTimes(1);
  });
  it("reveals how choices apply from the intro instead of a trailing disclosure", () => {
    setup();
    const help = screen.getByRole("button", { name: "How these classifications apply" });
    expect(help.getAttribute("aria-expanded")).toBe("false");
    fireEvent.click(help);
    expect(help.getAttribute("aria-expanded")).toBe("true");
    expect(document.getElementById(help.getAttribute("aria-controls") ?? "")?.hidden).toBe(false);
  });
  it("filters a long list by exact detail and keeps the original target when editing", async () => {
    const rules = Array.from({ length: 24 }, (_, index) => ({ ...rule, id: "page-" + index, detailValue: "https://example.com/course/" + index }));
    const { onSaveRule } = setup(rules);
    const search = screen.getByRole("searchbox");
    fireEvent.change(search, { target: { value: "/course/23" } });
    expect(screen.getAllByRole("article")).toHaveLength(1);
    expect(screen.getByText("1 of 24 classifications")).toBeTruthy();
    chooseFromOptions("https://example.com/course/23", "Edit");
    fireEvent.click(screen.getByRole("button", { name: "Save changes" }));
    await waitFor(() => expect(onSaveRule).toHaveBeenCalledWith(expect.objectContaining({ detailValue: "https://example.com/course/23" })));
    fireEvent.change(search, { target: { value: "missing-page" } });
    expect(screen.queryAllByRole("article")).toHaveLength(0);
    expect(screen.getByText("No matching classifications. Try another search.")).toBeTruthy();
    fireEvent.change(search, { target: { value: "" } });
    expect(screen.getAllByRole("article")).toHaveLength(24);
  });
  it("says how many past records an enabled rule's edit applies to, asking once per opened form", async () => {
    const preview = vi.spyOn(trackerClient, "previewClassificationRule").mockResolvedValue({ matchedCount: 1234, matchedSeconds: 21000, manualCount: 0 });
    setup([{ ...rule, enabled: true }]);
    chooseFromOptions("https://example.com/course", "Edit");
    expect(await screen.findByText("Applies to 1,234 past records (5h 50m) and future ones.")).toBeTruthy();
    fireEvent.click(screen.getByRole("combobox", { name: "Category" }));
    fireEvent.click(screen.getByRole("option", { name: "Communication" }));
    expect(screen.getByText("Applies to 1,234 past records (5h 50m) and future ones.")).toBeTruthy();
    expect(preview).toHaveBeenCalledTimes(1);
    expect(preview).toHaveBeenCalledWith(expect.objectContaining({ targetKind: "site", targetValue: "example.com", matchScope: "detail", detailKind: "siteUrl", detailValue: "https://example.com/course", enabled: true }));
  });
  it("keeps the one-time edit sentence only when such records exist, and says a turned-off rule applies to nothing", async () => {
    const preview = vi.spyOn(trackerClient, "previewClassificationRule").mockResolvedValue({ matchedCount: 1, matchedSeconds: 1500, manualCount: 2 });
    setup([{ ...rule, enabled: true }, { ...rule, id: "off", detailValue: "https://example.com/off" }]);
    chooseFromOptions("https://example.com/course", "Edit");
    expect(await screen.findByText("Applies to 1 past record (25m) and future ones. One-time manual edits stay.")).toBeTruthy();
    chooseFromOptions("https://example.com/off", "Edit");
    expect(screen.getByText("While it's off, it doesn't apply to any records.")).toBeTruthy();
    expect(preview).toHaveBeenCalledTimes(1);
  });
  it("says when no past record changes, and reads as before when the count is unavailable", async () => {
    vi.spyOn(trackerClient, "previewClassificationRule")
      .mockResolvedValueOnce({ matchedCount: 0, matchedSeconds: 0, manualCount: 0 })
      .mockRejectedValueOnce(new Error("tracker unavailable"));
    setup([{ ...rule, enabled: true }, { ...rule, id: "second", enabled: true, detailValue: "https://example.com/second" }]);
    chooseFromOptions("https://example.com/course", "Edit");
    expect(await screen.findByText("No past records change; future ones will.")).toBeTruthy();
    chooseFromOptions("https://example.com/second", "Edit");
    await waitFor(() => expect(screen.getByText("Matching existing and future records will update. One-time manual edits stay.")).toBeTruthy());
    expect(screen.getAllByRole("button", { name: "Save changes" })).toHaveLength(2);
  });
});
