// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import type { ActivitySegment, ClassificationRule } from "@drifty/domain";
import { ClassificationSavedRulesList } from "./ClassificationSavedRulesList";

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
describe("saved classification management", () => {
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

});
