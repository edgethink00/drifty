// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { PrivacySettingsSection } from "./PrivacySettingsSection";

const AI_PRIVACY_REQUEST_SETTINGS_STORAGE_KEY = "drifty.aiPrivacyRequestSettings.v1";
const REMOVED_PRIVACY_HELPER_COPY = [
  `Helps distinguish work from ${"drift."}`,
  `Needed for a useful category ${"result."}`,
  `Useful for personalized work ${"categories."}`,
] as const;

function openAiDataSending() {
  render(<PrivacySettingsSection />);
  fireEvent.click(screen.getByRole("button", { name: /AI data sending/i }));
}

describe("PrivacySettingsSection AI review", () => {
  afterEach(cleanup);

  beforeEach(() => {
    window.localStorage.clear();
  });

  it("persists optional AI privacy request controls from Privacy settings", () => {
    openAiDataSending();

    expect(screen.getByRole("region", { name: /AI privacy review/i })).toBeTruthy();
    const requiredFields = screen.getByRole("list", { name: /Required AI classification fields/i });
    const optionalFields = screen.getByRole("list", { name: /Optional AI classification fields/i });
    // The receipt states each always-sent field by name, with the value that would
    // actually leave this computer for the worked example.
    expect(within(requiredFields).getByText(/^App$/i)).toBeTruthy();
    expect(within(requiredFields).getByText(/^Duration$/i)).toBeTruthy();
    expect(within(requiredFields).getByText(/^Site domain$/i)).toBeTruthy();
    expect(within(requiredFields).queryByRole("switch", { name: /Site domain/i })).toBeNull();
    expect(within(requiredFields).getAllByRole("listitem")).toHaveLength(3);
    expect(within(requiredFields).getAllByText(/^Always sent$/i)).toHaveLength(3);
    // The fixture must never read as the user's own captured activity.
    expect(screen.getByText(/Example segment .* not your activity/i)).toBeTruthy();
    expect(within(optionalFields).getByRole("switch", { name: /Page address/i })).toBeTruthy();
    expect(within(optionalFields).getByRole("switch", { name: /Window title/i })).toBeTruthy();
    expect(within(optionalFields).getByRole("switch", { name: /^Content context$/i })).toBeTruthy();
    expect(within(optionalFields).getByRole("switch", { name: /^Work profile$/i })).toBeTruthy();
    // Both truncation limits are disclosed, not just the page address one.
    expect(within(optionalFields).getByText(/cut to 300 characters/i)).toBeTruthy();
    expect(within(optionalFields).getByText(/Cut to 160 characters/i)).toBeTruthy();
    const optionalSwitches = within(optionalFields).getAllByRole("switch");
    expect(optionalSwitches).toHaveLength(4);
    for (const optionalSwitch of optionalSwitches) {
      if (!(optionalSwitch instanceof HTMLInputElement)) throw new Error("Optional privacy controls should render as switches.");
      expect(optionalSwitch.checked).toBe(true);
    }
    for (const helperCopy of REMOVED_PRIVACY_HELPER_COPY) {
      expect(screen.queryByText(helperCopy)).toBeNull();
    }

    const siteUrlSwitch = within(optionalFields).getByRole("switch", { name: /Page address/i });
    fireEvent.click(siteUrlSwitch);
    expect(JSON.parse(window.localStorage.getItem(AI_PRIVACY_REQUEST_SETTINGS_STORAGE_KEY) ?? "{}")).toMatchObject({
      version: 1,
      optional: {
        siteUrl: false,
        windowTitle: true,
        contentContext: true,
        workProfile: true,
      },
    });

    expect(screen.queryByRole("button", { name: /Save selection/i })).toBeNull();
    expect(screen.queryByRole("button", { name: /Reset optional/i })).toBeNull();
    expect(screen.getByText(/Raw timeline rows/i)).toBeTruthy();
    expect(screen.getByText(/YouTube descriptions/i)).toBeTruthy();
  });

  it("provides one default-on product analytics opt-out", () => {
    render(<PrivacySettingsSection />);
    const preference = screen.getByRole("switch", { name: /share product analytics/i });
    if (!(preference instanceof HTMLInputElement)) throw new Error("Product analytics preference should be a switch.");

    expect(preference.checked).toBe(true);
    fireEvent.click(preference);
    expect(preference.checked).toBe(false);
    expect(window.localStorage.getItem("drifty.privacy.productAnalytics.v1")).toBe("0");
    expect(screen.getByText(/App names, sites, URLs, titles, segment IDs, and individual local activity times are never included/i)).toBeTruthy();
  });

  it("explains every receipt row and every never-sent claim in the two disclosure details", () => {
    openAiDataSending();

    // Glossary: one definition per row the receipt shows, including the two rows that are
    // not switchable (recent-activity and enhanced context).
    const glossary = screen.getByText("What each row means").closest("details");
    if (!(glossary instanceof HTMLDetailsElement)) throw new Error("The glossary should render as a details block.");
    const glossaryTerms = Array.from(glossary.querySelectorAll("dt"), (term) => term.textContent);
    expect(glossaryTerms).toEqual([
      "App",
      "Duration",
      "Site domain",
      "Page address",
      "Window title",
      "Content context",
      "Work profile",
      "Recent-activity context",
      "Enhanced context",
      // Project matching also sends what the user wrote when defining a project;
      // live classification does not, so it needs its own disclosure row.
      "Your project names and descriptions",
    ]);
    // The channel name is a real outbound field; it lost its only assertion when the
    // per-row tooltip was removed, so the glossary carries that coverage now.
    expect(within(glossary).getByText(/YouTube channel name/i)).toBeTruthy();
    expect(within(glossary).getByText(/only appears on a second attempt|only on a second attempt/i)).toBeTruthy();

    // Never-sent: every excluded claim is stated in receipt-grade wording.
    const neverSent = screen.getByText("What is never sent as classification data").closest("details");
    if (!(neverSent instanceof HTMLDetailsElement)) throw new Error("The never-sent list should render as a details block.");
    const neverSentTerms = Array.from(neverSent.querySelectorAll("dt"), (term) => term.textContent);
    expect(neverSentTerms).toEqual([
      "Raw timeline rows",
      "Full session history",
      "Raw document and message bodies",
      "YouTube descriptions",
      "Provider API keys",
    ]);
    expect(within(neverSent).getByText(/The description never is/i)).toBeTruthy();
    expect(within(neverSent).getByText(/operating system's credential store/i)).toBeTruthy();
  });

  it("falls back to enabled optional AI privacy controls when persisted settings are malformed", () => {
    window.localStorage.setItem(AI_PRIVACY_REQUEST_SETTINGS_STORAGE_KEY, "{broken json");
    openAiDataSending();

    const optionalFields = screen.getByRole("list", { name: /Optional AI classification fields/i });
    for (const optionalSwitch of within(optionalFields).getAllByRole("switch")) {
      if (!(optionalSwitch instanceof HTMLInputElement)) throw new Error("Optional privacy controls should render as switches.");
      expect(optionalSwitch.checked).toBe(true);
    }
  });

  it("maps legacy disabled title privacy to disabled window title and content context controls", () => {
    window.localStorage.setItem(AI_PRIVACY_REQUEST_SETTINGS_STORAGE_KEY, JSON.stringify({
      version: 1,
      optional: {
        siteUrl: true,
        title: false,
        workProfile: true,
      },
    }));
    openAiDataSending();

    const optionalFields = screen.getByRole("list", { name: /Optional AI classification fields/i });
    const windowTitleSwitch = within(optionalFields).getByRole("switch", { name: /Window title/i });
    const contentContextSwitch = within(optionalFields).getByRole("switch", { name: /^Content context$/i });
    if (!(windowTitleSwitch instanceof HTMLInputElement) || !(contentContextSwitch instanceof HTMLInputElement)) {
      throw new Error("Legacy privacy controls should render as switches.");
    }
    expect(windowTitleSwitch.checked).toBe(false);
    expect(contentContextSwitch.checked).toBe(false);
  });
});
