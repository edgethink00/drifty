// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import type { ClassificationRule } from "@drifty/domain";
import { ClassificationSavedRulesList } from "./ClassificationSavedRulesList";

const rule: ClassificationRule = { id: "existing", targetKind: "site", targetValue: "example.com", matchScope: "detail", detailKind: "siteUrl", detailValue: "https://example.com/course", category: "learning", productivity: "focus", enabled: false, confidence: 0.9 };
function setup(rules: ClassificationRule[] = [rule]) {
  const onSaveRule = vi.fn(async () => true);
  const onDeleteClassificationRule = vi.fn();
  const onToggleClassificationRule = vi.fn();
  render(<ClassificationSavedRulesList appIcons={{}} appThemeColorOverrides={{}} categoryColorOverrides={{}} hasError={false} saving={false} classificationRuleDeletingId={null} classificationRuleSegments={[]} classificationRules={rules} classificationRulesLoading={false} onLoadClassificationRules={vi.fn()} onSaveRule={onSaveRule} onDeleteClassificationRule={onDeleteClassificationRule} onToggleClassificationRule={onToggleClassificationRule} />);
  return { onSaveRule, onDeleteClassificationRule, onToggleClassificationRule };
}
afterEach(cleanup);
describe("saved classification management", () => {
  it("edits a legacy exact-page choice without changing its match or disabled state", async () => {
    const { onSaveRule } = setup();
    fireEvent.click(screen.getByRole("button", { name: "Edit" }));
    fireEvent.click(screen.getByRole("combobox", { name: "Category" }));
    fireEvent.click(screen.getByRole("option", { name: "Communication" }));
    fireEvent.click(screen.getByRole("button", { name: "Save changes" }));
    await waitFor(() => expect(onSaveRule).toHaveBeenCalledWith({ targetKind: "site", targetValue: "example.com", matchScope: "detail", detailKind: "siteUrl", detailValue: "https://example.com/course", category: "communication", productivity: "focus", enabled: false, confidence: 0.9 }));
    await waitFor(() => expect(screen.queryByRole("button", { name: "Save changes" })).toBeNull());
  });
  it("retains edits when saving fails so the user can retry", async () => {
    const { onSaveRule } = setup();
    onSaveRule.mockResolvedValueOnce(false);
    fireEvent.click(screen.getByRole("button", { name: "Edit" }));
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
    fireEvent.click(screen.getByRole("button", { name: "Remove" }));
    expect(onDeleteClassificationRule).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
    expect(onDeleteClassificationRule).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "Remove" }));
    fireEvent.click(screen.getByRole("button", { name: "Remove classification" }));
    expect(onDeleteClassificationRule).toHaveBeenCalledWith(rule);
  });
  it("filters a long list by exact detail and keeps the original target when editing", async () => {
    const rules = Array.from({ length: 24 }, (_, index) => ({ ...rule, id: `page-${index}`, detailValue: `https://example.com/course/${index}` }));
    const { onSaveRule } = setup(rules);
    const search = screen.getByRole("searchbox");
    fireEvent.change(search, { target: { value: "/course/23" } });
    expect(screen.getAllByRole("article")).toHaveLength(1);
    expect(screen.getByText("1 of 24 classifications")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Edit" }));
    fireEvent.click(screen.getByRole("button", { name: "Save changes" }));
    await waitFor(() => expect(onSaveRule).toHaveBeenCalledWith(expect.objectContaining({ detailValue: "https://example.com/course/23" })));
    fireEvent.change(search, { target: { value: "missing-page" } });
    expect(screen.queryAllByRole("article")).toHaveLength(0);
    expect(screen.getByText("No matching classifications. Try another search.")).toBeTruthy();
    fireEvent.change(search, { target: { value: "" } });
    expect(screen.getAllByRole("article")).toHaveLength(24);
  });

});
