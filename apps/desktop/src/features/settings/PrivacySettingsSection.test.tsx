// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { LocalizationTestProvider } from "../localization/LocalizationContext";

import { trackerClient } from "../../lib/api/trackerClient";
import { PrivacySettingsSection } from "./PrivacySettingsSection";

const AI_PRIVACY_REQUEST_SETTINGS_STORAGE_KEY = "drifty.aiPrivacyRequestSettings.v1";
const PRODUCT_ANALYTICS_STORAGE_KEY = "drifty.privacy.productAnalytics.v1";
const REMOVED_PRIVACY_HELPER_COPY = [
  `Helps distinguish work from ${"drift."}`,
  `Needed for a useful category ${"result."}`,
  `Useful for personalized work ${"categories."}`,
] as const;

function isOn(control: HTMLElement): boolean {
  return control.getAttribute("aria-checked") === "true";
}

function groupNamed(settingId: string): HTMLElement {
  const group = document.querySelector(`[data-setting-id="${settingId}"]`);
  if (!(group instanceof HTMLElement)) throw new Error(`Missing settings group ${settingId}.`);
  return group;
}

function rowOf(control: HTMLElement): HTMLElement {
  const row = control.closest(".settings-row");
  if (!(row instanceof HTMLElement)) throw new Error("The control should live in a settings row.");
  return row;
}

/** The AI group is a folded card; its rows exist for the user only once it is open. */
function openAiGroup(): HTMLElement {
  const toggle = screen.getByRole("button", { name: /^AI data sending/ });
  if (toggle.getAttribute("aria-expanded") !== "true") fireEvent.click(toggle);
  return groupNamed("settings.privacy.aiSending");
}

function openSharingDetails(): HTMLElement {
  const toggle = screen.getByRole("button", { name: "Data sharing details" });
  if (toggle.getAttribute("aria-expanded") !== "true") fireEvent.click(toggle);
  return groupNamed("settings.privacy.driftySharing");
}

/** Opens the AI details dialog from its row in the AI data sending group. */
function openAiDetails(): HTMLElement {
  const group = within(openAiGroup());
  fireEvent.click(group.getByRole("button", { name: "Open" }));
  return screen.getByRole("dialog", { name: "See what is sent in detail" });
}

function sectionTitled(dialog: HTMLElement, title: string): HTMLElement {
  const section = within(dialog).getByRole("heading", { name: title, level: 3 }).closest("section");
  if (!(section instanceof HTMLElement)) throw new Error(`"${title}" should render as a section of the AI details.`);
  return section;
}

describe("PrivacySettingsSection", () => {
  afterEach(() => { cleanup(); vi.restoreAllMocks(); });

  beforeEach(() => {
    window.localStorage.clear();
  });

  it("lists the groups by where the data goes, the AI group folded as the privacy card's last row", () => {
    render(<PrivacySettingsSection />);

    const headings = screen.getAllByRole("heading", { level: 3 }).map((heading) => heading.textContent);
    expect(headings).toEqual([
      "Privacy & Data",
      "Data on this computer",
    ]);
    // The AI group is one folded card: a title and a one-line subtitle, no badges, no rows yet.
    const aiToggle = screen.getByRole("button", { name: /^AI data sending/ });
    expect(aiToggle.getAttribute("aria-expanded")).toBe("false");
    expect(aiToggle.textContent).toBe("AI data sendingWhat Drifty can send for AI classification");
    expect(aiToggle.querySelector(".chip")).toBeNull();
    // Everyday controls stay above the compact sharing footer.
    const order = Array.from(document.querySelectorAll(".settings-section--privacy > *"), (node) => node.getAttribute("data-setting-id") ?? node.querySelector("h3")?.textContent);
    expect(order.slice(0, 3)).toEqual(["Privacy & Data", "Data on this computer", "settings.privacy.driftySharing"]);
    // What may go to AI closes the card that says what is never recorded, rather
    // than standing apart as a card of its own (2026-10-29).
    const privacyCard = document.querySelector(".settings-section--privacy > .settings-block")!;
    const aiFold = privacyCard.lastElementChild!;
    expect(aiFold.getAttribute("data-setting-id")).toBe("settings.privacy.aiSending");
    expect(aiFold.classList.contains("settings-collapsible-card--row")).toBe(true);
    // A group is a flat block: every row is a direct child, so no row sits in a nested box.
    for (const block of document.querySelectorAll(".settings-section--privacy > .settings-block")) {
      const children = Array.from(block.children);
      expect(children[0]?.tagName).toBe("H3");
      for (const child of children.slice(1)) {
        if (child === aiFold) continue;
        expect(child.classList.contains("settings-row")).toBe(true);
      }
    }
  });

  it("shows every everyday control without opening anything", async () => {
    render(<PrivacySettingsSection />);

    expect(screen.queryByRole("switch", { name: "Usage statistics" })).toBeNull();
    expect(await screen.findByRole("searchbox", { name: "App name or site address" })).toBeTruthy();
    expect(screen.getByText("Apps and sites not to record")).toBeTruthy();
    expect(screen.queryByText("Database")).toBeNull();
    expect(screen.getByRole("button", { name: "Data sharing details" }).getAttribute("aria-expanded")).toBe("false");
    expect(screen.getByRole("button", { name: "Delete history…" })).toBeTruthy();
    // AI and sharing details are unavailable to keyboard navigation while closed.
    expect(screen.queryByRole("switch", { name: "Page address" })).toBeNull();
    expect(document.querySelector("details")).toBeNull();
    expect(screen.queryByText(/icon cache/i)).toBeNull();
    openAiGroup();
    expect(screen.getByRole("switch", { name: "Page address" })).toBeTruthy();
  });

  it("closes deletion after refresh, shows floating counts on Privacy and restores its trigger", async () => {
    vi.spyOn(trackerClient, "deleteHistoryRange").mockResolvedValue({ activitySegments: 1, classifications: 0, youtubeMetadata: 2, dryRun: false });
    const refresh = vi.fn().mockResolvedValue(undefined);
    render(<LocalizationTestProvider language="en"><PrivacySettingsSection onHistoryDeleted={refresh} /></LocalizationTestProvider>);
    const trigger = screen.getByRole("button", { name: "Delete history…" });
    trigger.focus();
    fireEvent.click(trigger);
    fireEvent.click(within(screen.getByRole("dialog", { name: "Delete history" })).getByRole("button", { name: "Delete permanently" }));
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    expect(refresh).toHaveBeenCalledTimes(1);
    expect(screen.getByRole("status", { name: "History deleted" }).textContent).toContain("1 activity segment · 2 YouTube metadata entries");
    expect(document.activeElement).toBe(trigger);
    fireEvent.click(screen.getByRole("button", { name: "Dismiss deletion result" }));
    await waitFor(() => expect(screen.queryByRole("status")).toBeNull());
    fireEvent.click(trigger);
    expect(screen.getByRole("dialog", { name: "Delete history" })).toBeTruthy();
  });

  describe("AI data sending", () => {
    it("states what is always sent and persists each optional control", () => {
      render(<PrivacySettingsSection />);
      const ai = within(openAiGroup());

      expect(ai.getByText("Always included")).toBeTruthy();
      expect(ai.getByText(/App · Duration · Site domain — needed for any classification, so always sent\./)).toBeTruthy();
      expect(ai.queryByRole("switch", { name: /Site domain/i })).toBeNull();

      const switches = ai.getAllByRole("switch");
      expect(switches.map((control) => control.getAttribute("aria-label"))).toEqual([
        "Page address",
        "Window title",
        "Content context",
        "Work profile",
      ]);
      for (const control of switches) expect(isOn(control)).toBe(true);
      // Both truncation limits are disclosed on their own rows, not just the page address one.
      expect(within(rowOf(ai.getByRole("switch", { name: "Page address" }))).getByText(/cut to 300 characters/i)).toBeTruthy();
      expect(within(rowOf(ai.getByRole("switch", { name: "Window title" }))).getByText(/Cut to 160 characters/i)).toBeTruthy();
      // The values are a fixed worked example, and each row says so.
      expect(ai.getByText(/^e\.g\. https:\/\/developer\.mozilla\.org/)).toBeTruthy();
      for (const helperCopy of REMOVED_PRIVACY_HELPER_COPY) expect(screen.queryByText(helperCopy)).toBeNull();

      fireEvent.click(ai.getByRole("switch", { name: "Page address" }));
      expect(JSON.parse(window.localStorage.getItem(AI_PRIVACY_REQUEST_SETTINGS_STORAGE_KEY) ?? "{}")).toMatchObject({
        version: 1,
        optional: { siteUrl: false, windowTitle: true, contentContext: true, workProfile: true },
      });
      expect(isOn(ai.getByRole("switch", { name: "Page address" }))).toBe(false);
      // A switched-off row states what classification loses, in place.
      expect(within(rowOf(ai.getByRole("switch", { name: "Page address" }))).getByText(/Two different pages on this domain look identical/i)).toBeTruthy();
      // The same sentence is announced, because the cost line is drawn but not otherwise spoken.
      expect(within(screen.getByRole("status")).getByText(/Two different pages on this domain look identical/i)).toBeTruthy();
      expect(screen.queryByRole("button", { name: /Save selection/i })).toBeNull();
      expect(screen.queryByRole("button", { name: /Reset optional/i })).toBeNull();
    });

    it("toggles from the row text, but a drag that selects text does not", () => {
      render(<PrivacySettingsSection />);
      const ai = within(openAiGroup());
      const windowTitle = ai.getByRole("switch", { name: "Window title" });
      const label = within(rowOf(windowTitle)).getByText("Window title");

      fireEvent.mouseDown(label, { clientX: 10, clientY: 10 });
      fireEvent.click(label, { clientX: 10, clientY: 10 });
      expect(isOn(windowTitle)).toBe(false);

      fireEvent.mouseDown(label, { clientX: 10, clientY: 10 });
      fireEvent.click(label, { clientX: 80, clientY: 10 });
      expect(isOn(windowTitle)).toBe(false);

      fireEvent.mouseDown(label, { clientX: 10, clientY: 10 });
      fireEvent.click(label, { clientX: 10, clientY: 10 });
      expect(isOn(windowTitle)).toBe(true);
    });

    it("explains every receipt row and every never-sent claim in the details dialog", () => {
      render(<PrivacySettingsSection />);
      const dialog = openAiDetails();

      // Glossary: one definition per row the receipt shows, including the two rows that are
      // not switchable (recent-activity and enhanced context).
      const glossary = sectionTitled(dialog, "What each row means");
      expect(Array.from(glossary.querySelectorAll("dt"), (term) => term.textContent)).toEqual([
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
        // live classification does not, so it needs its own glossary entry.
        "Your project names and descriptions",
        // Timeline cards send one finished stretch's records in time order.
        "Timeline cards",
        // Suggested memories send one place's totals, and its titles only when both title settings allow.
        "Suggested memories",
        // Category descriptions are the other user-written text a provider can read.
        "Your category and productivity descriptions",
        // Chat goes to the connection the person picks, not to the classification AI.
        "Chat (beta)",
      ]);
      expect(within(glossary).getByText(/Chat goes to the connection you pick, not to your classification AI/i)).toBeTruthy();
      expect(within(glossary).getByText(/each finished stretch of activity \(at most three hours\)/i)).toBeTruthy();
      expect(within(glossary).getByText(/up to 8 places .* Only with both Window title and Content context on/i)).toBeTruthy();
      expect(within(glossary).getByText(/both Window title and Content context off there are no titles to describe/i)).toBeTruthy();
      // The channel name is a real outbound field; the glossary carries its coverage.
      expect(within(glossary).getByText(/YouTube channel name/i)).toBeTruthy();
      expect(within(glossary).getByText(/separate anonymous HTTPS request/i)).toBeTruthy();
      expect(within(glossary).getByText(/without browser cookies or login/i)).toBeTruthy();
      expect(within(glossary).getByText(/only appears on a second attempt|only on a second attempt/i)).toBeTruthy();

      // Never-sent: the short row names every excluded item, and the details state each claim
      // in receipt-grade wording.
      const neverSentRow = rowOf(screen.getByText("What is never sent as classification data"));
      expect(neverSentRow.textContent).toContain("Raw timeline rows · Full session history · Full document and message bodies · YouTube descriptions · Provider API keys");
      const neverSent = sectionTitled(dialog, "What is never sent, explained");
      expect(Array.from(neverSent.querySelectorAll("dt"), (term) => term.textContent)).toEqual([
        "Raw timeline rows",
        "Full session history",
        "Full document and message bodies",
        "YouTube descriptions",
        "Provider API keys",
      ]);
      expect(within(neverSent).getByText(/fetched full video description and keywords are excluded/i)).toBeTruthy();
      expect(within(neverSent).getByText(/bounded author description from anonymous page metadata may overlap/i)).toBeTruthy();
      expect(within(neverSent).getByText(/operating system's credential store/i)).toBeTruthy();
    });

    /**
     * The footnote and the enhanced-context definition are each written as several keys so
     * they can render as separate lines. Splitting copy is only safe while every part is
     * still drawn, so the parts that moved out of the original paragraph are asserted here.
     */
    it("draws the example request with every part of the split footnote and enhanced-context copy", () => {
      render(<PrivacySettingsSection />);
      const dialog = openAiDetails();

      const receipt = sectionTitled(dialog, "Example request");
      expect(within(receipt).getByText(/Example segment .* not your activity/i)).toBeTruthy();
      const required = within(receipt).getByRole("list", { name: /Required AI classification fields/i });
      expect(within(required).getAllByRole("listitem")).toHaveLength(3);
      expect(within(required).getAllByText(/^Always sent$/i)).toHaveLength(3);

      const footnotes = receipt.querySelector(".ai-privacy-review__footnotes");
      if (!(footnotes instanceof HTMLElement)) throw new Error("The request footnotes should render as a list.");
      expect(within(footnotes).getAllByRole("listitem")).toHaveLength(3);
      expect(within(footnotes).getByText(/a fingerprint of the fields above/i)).toBeTruthy();
      expect(within(footnotes).getByText(/cloud route only/i)).toBeTruthy();
      expect(within(footnotes).getByText(/salted account hashes/i)).toBeTruthy();

      const glossary = sectionTitled(dialog, "What each row means");
      expect(within(glossary).getByText(/on a second attempt/i)).toBeTruthy();
      expect(within(glossary).getByText(/terminal commands/i)).toBeTruthy();
    });

    it("opens the details in a dialog that closes with Escape and returns focus to its row", async () => {
      render(<PrivacySettingsSection />);
      const open = within(openAiGroup()).getByRole("button", { name: "Open" });
      open.focus();

      const dialog = openAiDetails();
      expect(dialog.getAttribute("aria-modal")).toBe("true");
      // The page behind keeps its length: the reference text lives only in the dialog.
      expect(within(groupNamed("settings.privacy.aiSending")).queryByText("Example request")).toBeNull();

      fireEvent.keyDown(window, { key: "Escape" });
      await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
      expect(document.activeElement).toBe(open);
    });

    it("shows the example request for the switches that are set now", () => {
      window.localStorage.setItem(AI_PRIVACY_REQUEST_SETTINGS_STORAGE_KEY, JSON.stringify({
        version: 1,
        optional: { siteUrl: true, windowTitle: true, contentContext: true, workProfile: false },
      }));
      render(<PrivacySettingsSection />);
      const dialog = openAiDetails();

      expect(within(sectionTitled(dialog, "Example request")).getByText(/Work profile is off/i)).toBeTruthy();
    });

    it("falls back to enabled optional controls when persisted settings are malformed", () => {
      window.localStorage.setItem(AI_PRIVACY_REQUEST_SETTINGS_STORAGE_KEY, "{broken json");
      render(<PrivacySettingsSection />);

      for (const control of within(openAiGroup()).getAllByRole("switch")) {
        expect(isOn(control)).toBe(true);
      }
    });

    it("maps legacy disabled title privacy to disabled window title and content context controls", () => {
      window.localStorage.setItem(AI_PRIVACY_REQUEST_SETTINGS_STORAGE_KEY, JSON.stringify({
        version: 1,
        optional: { siteUrl: true, title: false, workProfile: true },
      }));
      render(<PrivacySettingsSection />);
      const ai = within(openAiGroup());

      expect(isOn(ai.getByRole("switch", { name: "Window title" }))).toBe(false);
      expect(isOn(ai.getByRole("switch", { name: "Content context" }))).toBe(false);
    });
  });

  describe("data shared with Drifty", () => {
    it("provides one default-on usage statistics opt-out that survives external updates", () => {
      render(<PrivacySettingsSection />);
      const preference = within(openSharingDetails()).getByRole("switch", { name: "Usage statistics" });

      expect(isOn(preference)).toBe(true);
      fireEvent.click(preference);
      expect(isOn(preference)).toBe(false);
      expect(window.localStorage.getItem(PRODUCT_ANALYTICS_STORAGE_KEY)).toBe("0");

      // Re-rendering for an unrelated reason must not turn a saved opt-out back on.
      openAiGroup();
      fireEvent.click(screen.getByRole("switch", { name: "Window title" }));
      expect(isOn(preference)).toBe(false);
      expect(window.localStorage.getItem(PRODUCT_ANALYTICS_STORAGE_KEY)).toBe("0");

      window.localStorage.setItem(PRODUCT_ANALYTICS_STORAGE_KEY, "1");
      fireEvent(window, new StorageEvent("storage", { key: PRODUCT_ANALYTICS_STORAGE_KEY }));
      expect(isOn(preference)).toBe(true);
    });

    it("starts off when the saved choice is off", () => {
      window.localStorage.setItem(PRODUCT_ANALYTICS_STORAGE_KEY, "0");
      render(<PrivacySettingsSection />);

      expect(screen.queryByRole("switch", { name: "Usage statistics" })).toBeNull();
      expect(isOn(within(openSharingDetails()).getByRole("switch", { name: "Usage statistics" }))).toBe(false);
    });

    it("keeps recipients, excluded fields and public scope in the sharing details", () => {
      render(<PrivacySettingsSection />);
      const drifty = within(openSharingDetails());

      expect(drifty.getByText(/PostHog receives named product events/i)).toBeTruthy();
      expect(drifty.getByText(/These events never include app names, sites, URLs, titles, segment IDs, or individual local activity times/i)).toBeTruthy();
      // The same switch decides whether finished Chat turns, which can carry window titles, are kept.
      expect(drifty.getByText(/finished Chat turns are also kept with your account .* can include window titles but never full URLs\./i)).toBeTruthy();
      // And whether minimized activity records are kept (2026-10-26), worded broadly like the policy.
      expect(drifty.getByText(/Depending on your AI connection, minimized records of your activity, such as apps, sites, titles, times and categories, are also kept to improve Drifty's AI features\. With this off, no new chats or activity records are kept\./i)).toBeTruthy();
      // The public-scope statement is a read-only row, not a setting with a missing switch.
      expect(drifty.getByText(/Raw tracking history is not published/i)).toBeTruthy();
      expect(drifty.getByText(/rolling 7 day focus total/i)).toBeTruthy();
      expect(drifty.getAllByRole("switch")).toHaveLength(1);
      expect(drifty.getByRole("link", { name: "Privacy policy" }).getAttribute("href")).toBe("https://drifty.so/privacy/");
      // Error reporting is not a row on this page.
      expect(screen.queryByText(/Error diagnostics/i)).toBeNull();
    });

    it("links the Korean policy row to the Korean privacy policy", () => {
      render(<LocalizationTestProvider language="ko"><PrivacySettingsSection /></LocalizationTestProvider>);

      expect(screen.getByRole("link", { name: "개인정보처리방침" }).getAttribute("href")).toBe("https://drifty.so/ko/privacy/");
      expect(screen.queryByRole("switch", { name: "사용 통계" })).toBeNull();
      fireEvent.click(screen.getByRole("button", { name: "데이터 공유 자세히" }));
      expect(screen.getByRole("switch", { name: "사용 통계" })).toBeTruthy();
    });
  });
});
