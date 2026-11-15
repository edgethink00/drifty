// @vitest-environment jsdom
import { useState } from "react";
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { SettingsSearch } from "./SettingsSearch";
import { SettingsSearchDestination, SettingsSearchNavigatorBridge, SettingsSearchProvider } from "./SettingsSearchContext";
import { FRIEND_INVITE_SETTING_ID, SETTINGS_SEARCH_ENTRIES, type SettingsSearchEntry } from "./settingsSearchCatalog";
import { SettingsCollapsibleCard } from "./SettingsCollapsibleCard";
import { PrivacySettingsSection } from "./PrivacySettingsSection";
import { LocalizationTestProvider } from "../localization/LocalizationContext";
import type { SettingsSection } from "./SettingsSidebar";
import { searchSettings, type SettingsSearchAvailability } from "./settingsSearchIndex";

const publicAvailability: SettingsSearchAvailability = { dev: false, intelligence: true, windows: false, backgroundUpdates: true, signedIn: false, deviceSync: false };

afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

describe("settings search", () => {
  it("finds bilingual user intent regardless of display language, case, or Korean spacing", () => {
    expect(searchSettings("자동 실행", publicAvailability).some((entry) => entry.id === "settings.general.openAtLogin")).toBe(true);
    expect(searchSettings("DARK MODE", publicAvailability).some((entry) => entry.id === "settings.appearance.theme")).toBe(true);
    expect(searchSettings("API 키", publicAvailability).some((entry) => entry.id === "settings.ai.openRouterApiKey")).toBe(true);
    expect(searchSettings("데이터삭제", publicAvailability).some((entry) => entry.id === "settings.privacy.deleteTitle")).toBe(true);
    expect(searchSettings("  ", publicAvailability)).toEqual([]);
    expect(searchSettings("there-is-no-such-setting-928", publicAvailability)).toEqual([]);
  });

  it("lands AI results on their own AI settings section", () => {
    const sectionFor = (query: string, id: string) => searchSettings(query, publicAvailability).find((entry) => entry.id === id)?.section;
    expect(sectionFor("OpenRouter", "settings.ai.openRouterApiKey")).toBe("aiSetup");
    expect(sectionFor("ChatGPT", "settings.ai.openAiApiKey")).toBe("aiSetup");
    expect(sectionFor("Claude", "settings.ai.anthropicApiKey")).toBe("aiSetup");
    expect(sectionFor("프로젝트 분석", "settings.ai.intelligence")).toBe("intelligence");
    expect(sectionFor("업무 프로필", "settings.ai.workProfile")).toBe("memory");
    expect(sectionFor("memory", "settings.ai.memoryHeroTitle")).toBe("memory");
  });

  it("omits gated destinations from search, including Dev in production", () => {
    const enabled = { dev: true, intelligence: true, windows: true, backgroundUpdates: true, signedIn: true, deviceSync: true };
    const disabled = { dev: false, intelligence: false, windows: false, backgroundUpdates: false, signedIn: false, deviceSync: false };
    expect(searchSettings("Diagnostics", enabled).some((entry) => entry.section === "dev")).toBe(true);
    expect(searchSettings("Diagnostics", disabled).some((entry) => entry.section === "dev")).toBe(false);
    for (const query of ["sync", "Intelligence", "update", "delete"]) {
      expect(searchSettings(query, disabled).every((entry) => !entry.gate)).toBe(true);
    }
    expect(searchSettings("Developer mode", enabled).some((entry) => entry.id === "settings.general.devMode")).toBe(true);
    expect(searchSettings("Developer mode", disabled).some((entry) => entry.id === "settings.general.devMode")).toBe(false);
    // Promo code follows the Account row: no result where the row is hidden.
    expect(searchSettings("promo", { ...disabled, promoCode: true }).some((entry) => entry.id === "settings.account.couponTitle")).toBe(true);
    expect(searchSettings("promo", disabled).some((entry) => entry.id === "settings.account.couponTitle")).toBe(false);
    // The iPhone section exists only where the App Store offers the app.
    expect(searchSettings("아이폰", { ...disabled, phoneApp: true }).find((entry) => entry.id === "settings.phoneApp.section")?.section).toBe("sync");
    expect(searchSettings("iPhone app", { ...disabled, phoneApp: true }).some((entry) => entry.id === "settings.phoneApp.section")).toBe(true);
    expect(searchSettings("아이폰", disabled).some((entry) => entry.id === "settings.phoneApp.section")).toBe(false);
  });

  it("finds Window blur in General's appearance block with Dev mode off", () => {
    const windows = { ...publicAvailability, windows: true };
    const result = searchSettings("블러", windows).find((entry) => entry.id === "settings.appearance.windowsBlur");
    expect(result?.section).toBe("general");
    expect(result?.devSubsection).toBeUndefined();
    expect(searchSettings("blur", publicAvailability).some((entry) => entry.id === "settings.appearance.windowsBlur")).toBe(false);
  });

  it("opens the category editor on the group a definition result belongs to", () => {
    const tabOf = (query: string, id: string) => searchSettings(query, { ...publicAvailability, intelligence: true }).find((entry) => entry.id === id);
    expect(tabOf("딴짓", "settings.categories.productivity")).toMatchObject({ section: "general", categoryEditor: { group: "productivity" } });
    expect(tabOf("카테고리 색상", "settings.categories.colors")).toMatchObject({ section: "general", categoryEditor: { group: "category" } });
    expect(tabOf("project", "settings.categories.projects")).toMatchObject({ section: "general", categoryEditor: { group: "project" } });
    expect(tabOf("도메인", "classification.rules.add")).toMatchObject({ section: "memory" });
    expect(searchSettings("project", { ...publicAvailability, intelligence: false }).some((entry) => entry.id === "settings.categories.projects")).toBe(false);
  });

  it("finds the app icon picker in General's Appearance block on Mac only", () => {
    const mac = { ...publicAvailability, macos: true };
    for (const query of ["앱 아이콘", "로고", "Dock icon"]) {
      expect(searchSettings(query, mac).find((entry) => entry.id === "settings.appearance.appIcon")?.section).toBe("general");
    }
    expect(searchSettings("앱 아이콘", { ...publicAvailability, windows: true }).some((entry) => entry.id === "settings.appearance.appIcon")).toBe(false);
  });

  it("finds hover controls in public Pet settings with Dev mode off", () => {
    for (const query of ["촬영", "호버", "recording", "hover controls"]) {
      const result = searchSettings(query, publicAvailability).find((entry) => entry.id === "settings.pet.showHoverControls");
      expect(result?.section).toBe("pet");
      expect(result?.gate).toBeUndefined();
      expect(result?.devSubsection).toBeUndefined();
    }
  });

  it("provides result/empty states, clear and Escape, without losing the existing navigation", () => {
    render(<LocalizationTestProvider><SettingsSearch><nav aria-label="Existing navigation" /></SettingsSearch></LocalizationTestProvider>);
    const input = screen.getByRole("combobox", { name: "설정 검색" });
    fireEvent.change(input, { target: { value: "nonesuch-qaz" } });
    expect(screen.getByRole("status").textContent).toBe("No settings found");
    expect(screen.getByRole("navigation")).toBeTruthy();
    fireEvent.keyDown(input, { key: "Escape" });
    expect(screen.queryByRole("listbox")).toBeNull();
    expect((input as HTMLInputElement).value).toBe("nonesuch-qaz");
    expect(screen.getByRole("navigation")).toBeTruthy();
    fireEvent.keyDown(input, { key: "ArrowDown" });
    expect(screen.getByRole("status").textContent).toBe("No settings found");
    fireEvent.change(input, { target: { value: "테마" } });
    fireEvent.click(screen.getByRole("button", { name: "검색어 지우기" }));
    expect(document.activeElement).toBe(input);
    expect(screen.getByRole("navigation")).toBeTruthy();
  });

  it("keeps navigation mounted and dismisses the floating results on outside click or keyboard blur", () => {
    render(<SettingsSearch><nav><button>General section</button></nav></SettingsSearch>);
    const input = screen.getByRole("combobox");
    const navigation = screen.getByRole("navigation");
    fireEvent.change(input, { target: { value: "Theme" } });
    expect(screen.getByRole("navigation")).toBe(navigation);
    // The results still escape the settings layout into a body-level portal; the
    // presence boundary that carries their open/close motion travels with them.
    const results = screen.getByRole("listbox").closest(".settings-search__results");
    expect(results?.parentElement?.getAttribute("data-anchored-presence")).toBe("entering");
    expect(results?.closest("[data-anchored-presence]")?.parentElement).toBe(document.body);
    fireEvent.pointerDown(screen.getByRole("button", { name: "General section" }));
    expect(screen.queryByRole("listbox")).toBeNull();
    fireEvent.focus(input);
    expect(screen.getByRole("listbox")).toBeTruthy();
    fireEvent.blur(input, { relatedTarget: screen.getByRole("button", { name: "General section" }) });
    expect(screen.queryByRole("listbox")).toBeNull();
  });

  it("moves keyboard selection, ignores IME Enter, and routes only on committed activation", () => {
    const navigate = vi.fn();
    render(<SettingsSearchProvider activeSection="general" availability={publicAvailability} onNavigate={navigate}>
      <SettingsSearch><nav /></SettingsSearch>
    </SettingsSearchProvider>);
    const input = screen.getByRole("combobox");
    fireEvent.change(input, { target: { value: "color" } });
    const options = screen.getAllByRole("option");
    expect(options.length).toBeGreaterThan(1);
    fireEvent.keyDown(input, { key: "Escape" });
    fireEvent.keyDown(input, { key: "ArrowUp" });
    expect(input.getAttribute("aria-activedescendant")).toBe(options[options.length - 1]!.id);
    fireEvent.keyDown(input, { key: "Escape" });
    fireEvent.keyDown(input, { key: "ArrowDown" });
    expect(input.getAttribute("aria-activedescendant")).toBe(options[0]!.id);
    fireEvent.keyDown(input, { key: "ArrowDown" });
    expect(input.getAttribute("aria-activedescendant")).toBe(options[1]!.id);
    fireEvent.keyDown(input, { key: "Enter", isComposing: true });
    expect(navigate).not.toHaveBeenCalled();
    fireEvent.keyDown(input, { key: "Enter" });
    expect(navigate).toHaveBeenCalledTimes(1);
    expect(screen.queryByRole("listbox")).toBeNull();
  });

  it("lands a shortcut from outside Settings on the friend invite card only while invites are open", async () => {
    vi.stubGlobal("requestAnimationFrame", (callback: FrameRequestCallback) => window.setTimeout(() => callback(0), 0));
    vi.stubGlobal("cancelAnimationFrame", (id: number) => window.clearTimeout(id));
    const entry = SETTINGS_SEARCH_ENTRIES.find((candidate) => candidate.id === FRIEND_INVITE_SETTING_ID);
    if (!entry) throw new Error("friend invite entry missing");
    const navigateRef: { current: ((target: SettingsSearchEntry) => void) | null } = { current: null };
    function Harness({ invitesOpen }: { readonly invitesOpen: boolean }) {
      const [section, setSection] = useState<SettingsSection | null>(null);
      return <SettingsSearchProvider activeSection={section} availability={{ ...publicAvailability, friendInvite: invitesOpen }} onNavigate={(target) => setSection(target.section)}>
        <SettingsSearchNavigatorBridge navigateRef={navigateRef} />
        <SettingsSearchDestination>
          {section === "account" ? <div data-setting-id={FRIEND_INVITE_SETTING_ID}>Invite friends</div> : <div>Elsewhere</div>}
        </SettingsSearchDestination>
      </SettingsSearchProvider>;
    }
    const closed = render(<Harness invitesOpen={false} />);
    navigateRef.current?.(entry);
    expect(screen.getByText("Elsewhere")).toBeTruthy();
    closed.unmount();

    render(<Harness invitesOpen />);
    navigateRef.current?.(entry);
    await waitFor(() => expect(document.activeElement?.getAttribute("data-setting-id")).toBe(FRIEND_INVITE_SETTING_ID));
    expect(searchSettings("친구 초대", { ...publicAvailability, friendInvite: true }).some((found) => found.id === FRIEND_INVITE_SETTING_ID)).toBe(true);
    expect(searchSettings("referral", publicAvailability).some((found) => found.id === FRIEND_INVITE_SETTING_ID)).toBe(false);
  });

  it("mounts a destination, unfolds it and focuses the row without activating its control; repeat navigation works", async () => {
    const changeSetting = vi.fn();
    vi.stubGlobal("requestAnimationFrame", (callback: FrameRequestCallback) => window.setTimeout(() => callback(0), 0));
    vi.stubGlobal("cancelAnimationFrame", (id: number) => window.clearTimeout(id));
    function Harness() {
      const [section, setSection] = useState<SettingsSection>("general");
      return <SettingsSearchProvider activeSection={section} availability={publicAvailability} onNavigate={(entry) => setSection(entry.section)}>
        <SettingsSearch><nav /></SettingsSearch>
        <SettingsSearchDestination>
          {section === "privacy" ? <SettingsCollapsibleCard title="Privacy" searchReveal="privacy-ai">
            <div data-setting-id="settings.privacy.aiSending">AI data sending <button onClick={changeSetting}>Change</button></div>
          </SettingsCollapsibleCard> : <div>General</div>}
        </SettingsSearchDestination>
      </SettingsSearchProvider>;
    }
    render(<Harness />);
    const input = screen.getByRole("combobox");
    fireEvent.change(input, { target: { value: "AI data sending" } });
    fireEvent.keyDown(input, { key: "Enter" });
    await waitFor(() => expect(document.activeElement?.getAttribute("data-setting-id")).toBe("settings.privacy.aiSending"));
    expect(screen.getByRole("button", { name: "Privacy" }).getAttribute("aria-expanded")).toBe("true");
    expect(changeSetting).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "Privacy" }));
    fireEvent.change(input, { target: { value: "AI data sending" } });
    fireEvent.keyDown(input, { key: "Enter" });
    await waitFor(() => expect(screen.getByRole("button", { name: "Privacy" }).getAttribute("aria-expanded")).toBe("true"));
    expect(changeSetting).not.toHaveBeenCalled();
  });
  it.each([undefined, 0])("keeps repeated search focused after the highlight expires and restores the original tabindex %s on blur", async (originalTabIndex) => {
    vi.stubGlobal("requestAnimationFrame", (callback: FrameRequestCallback) => window.setTimeout(() => callback(0), 0));
    vi.stubGlobal("cancelAnimationFrame", (id: number) => window.clearTimeout(id));
    function Harness() {
      const [section, setSection] = useState<SettingsSection>("general");
      return <SettingsSearchProvider activeSection={section} availability={publicAvailability} onNavigate={(entry) => setSection(entry.section)}>
        <SettingsSearch><nav /></SettingsSearch>
        <SettingsSearchDestination>{section === "privacy" ?
          <div data-setting-id="settings.privacy.productAnalyticsTitle" tabIndex={originalTabIndex}>Usage statistics <button>Next control</button></div> : null}
        </SettingsSearchDestination>
      </SettingsSearchProvider>;
    }
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
    try {
      render(<Harness />);
      const input = screen.getByRole("combobox");
      fireEvent.change(input, { target: { value: "PostHog" } });
      fireEvent.keyDown(input, { key: "Enter" });
      await act(async () => { await vi.advanceTimersByTimeAsync(1); });
      const row = document.querySelector<HTMLElement>('[data-setting-id="settings.privacy.productAnalyticsTitle"]')!;
      expect(document.activeElement).toBe(row);
      fireEvent.change(input, { target: { value: "PostHog" } });
      fireEvent.keyDown(input, { key: "Enter" });
      await act(async () => { await vi.advanceTimersByTimeAsync(1); });
      expect(document.activeElement).toBe(row);
      await act(async () => { await vi.advanceTimersByTimeAsync(2200); });
      expect(row.classList.contains("settings-search-target")).toBe(false);
      expect(document.activeElement).toBe(row);
      expect(row.getAttribute("tabindex")).toBe(originalTabIndex === undefined ? "-1" : "0");
      act(() => screen.getByRole("button", { name: "Next control" }).focus());
      expect(row.getAttribute("tabindex")).toBe(originalTabIndex === undefined ? null : "0");
    } finally {
      vi.useRealTimers();
    }
  });

  it("unfolds the AI data sending card when search lands on it, without changing any setting", async () => {
    window.localStorage.setItem("drifty.aiPrivacyRequestSettings.v1", JSON.stringify({
      version: 1,
      optional: { siteUrl: false, windowTitle: true, contentContext: true, workProfile: true },
    }));
    vi.stubGlobal("requestAnimationFrame", (callback: FrameRequestCallback) => window.setTimeout(() => callback(0), 0));
    vi.stubGlobal("cancelAnimationFrame", (id: number) => window.clearTimeout(id));
    function Harness() {
      const [section, setSection] = useState<SettingsSection>("general");
      return <SettingsSearchProvider activeSection={section} availability={publicAvailability} onNavigate={(entry) => setSection(entry.section)}>
        <SettingsSearch><nav /></SettingsSearch>
        <SettingsSearchDestination>{section === "privacy" ? <PrivacySettingsSection /> : null}</SettingsSearchDestination>
      </SettingsSearchProvider>;
    }
    render(<Harness />);
    const input = screen.getByRole("combobox");
    fireEvent.change(input, { target: { value: "AI data sending" } });
    fireEvent.keyDown(input, { key: "Enter" });
    await waitFor(() => expect(document.activeElement?.getAttribute("data-setting-id")).toBe("settings.privacy.aiSending"));
    expect(screen.getByRole("button", { name: /^AI data sending/ }).getAttribute("aria-expanded")).toBe("true");
    // Landing on the card never flips a switch inside it.
    expect(screen.getByRole("switch", { name: "Page address" }).getAttribute("aria-checked")).toBe("false");
    expect(screen.getByRole("switch", { name: "Window title" }).getAttribute("aria-checked")).toBe("true");
    window.localStorage.removeItem("drifty.aiPrivacyRequestSettings.v1");
  });

  it("finds screen text in both languages and reveals the switch without changing it", async () => {
    for (const query of ["screen text", "화면 글자", "OCR"]) {
      expect(searchSettings(query, publicAvailability)[0]?.id).toBe("settings.aiPrivacy.screenText");
    }
    window.localStorage.setItem("drifty.aiPrivacyRequestSettings.v1", JSON.stringify({
      version: 1,
      optional: { siteUrl: true, windowTitle: true, contentContext: true, workProfile: true, screenText: false },
    }));
    vi.stubGlobal("requestAnimationFrame", (callback: FrameRequestCallback) => window.setTimeout(() => callback(0), 0));
    vi.stubGlobal("cancelAnimationFrame", (id: number) => window.clearTimeout(id));
    function Harness() {
      const [section, setSection] = useState<SettingsSection>("general");
      return <SettingsSearchProvider activeSection={section} availability={publicAvailability} onNavigate={(entry) => setSection(entry.section)}>
        <SettingsSearch><nav /></SettingsSearch>
        <SettingsSearchDestination>{section === "privacy" ? <PrivacySettingsSection /> : null}</SettingsSearchDestination>
      </SettingsSearchProvider>;
    }
    render(<Harness />);
    const input = screen.getByRole("combobox");
    fireEvent.change(input, { target: { value: "screen text" } });
    fireEvent.keyDown(input, { key: "Enter" });
    await waitFor(() => expect(document.activeElement?.getAttribute("data-setting-id")).toBe("settings.aiPrivacy.screenText"));
    expect(screen.getByRole("button", { name: /^AI data sending/ }).getAttribute("aria-expanded")).toBe("true");
    expect(screen.getByRole("switch", { name: "Screen text" }).getAttribute("aria-checked")).toBe("false");
    window.localStorage.removeItem("drifty.aiPrivacyRequestSettings.v1");
  });

  it("finds and focuses usage statistics without changing a saved opt-out", async () => {
    window.localStorage.setItem("drifty.privacy.productAnalytics.v1", "0");
    vi.stubGlobal("requestAnimationFrame", (callback: FrameRequestCallback) => window.setTimeout(() => callback(0), 0));
    vi.stubGlobal("cancelAnimationFrame", (id: number) => window.clearTimeout(id));
    for (const query of ["사용 통계", "PostHog", "telemetry"]) {
      expect(searchSettings(query, publicAvailability).some((entry) => entry.id === "settings.privacy.productAnalyticsTitle")).toBe(true);
    }
    function Harness() {
      const [section, setSection] = useState<SettingsSection>("general");
      return <SettingsSearchProvider activeSection={section} availability={publicAvailability} onNavigate={(entry) => setSection(entry.section)}>
        <SettingsSearch><nav /></SettingsSearch>
        <SettingsSearchDestination>{section === "privacy" ? <PrivacySettingsSection /> : null}</SettingsSearchDestination>
      </SettingsSearchProvider>;
    }
    render(<Harness />);
    const input = screen.getByRole("combobox");
    fireEvent.change(input, { target: { value: "PostHog" } });
    fireEvent.keyDown(input, { key: "Enter" });
    await waitFor(() => expect(document.activeElement?.getAttribute("data-setting-id")).toBe("settings.privacy.productAnalyticsTitle"));
    const preference = screen.getByRole("switch", { name: "Usage statistics" });
    expect(preference.getAttribute("aria-checked")).toBe("false");
    expect(window.localStorage.getItem("drifty.privacy.productAnalytics.v1")).toBe("0");
    window.localStorage.removeItem("drifty.privacy.productAnalytics.v1");
  });

  it("keeps a pending request across delayed navigation and consumes it before destination remount", async () => {
    vi.stubGlobal("requestAnimationFrame", (callback: FrameRequestCallback) => window.setTimeout(() => callback(0), 0));
    vi.stubGlobal("cancelAnimationFrame", (id: number) => window.clearTimeout(id));
    function Harness() {
      const [section, setSection] = useState<SettingsSection>("pet");
      const [revision, setRevision] = useState(0);
      return <SettingsSearchProvider activeSection={section} availability={publicAvailability}
        onNavigate={(entry) => window.setTimeout(() => setSection(entry.section), 20)}>
        <SettingsSearch><nav /></SettingsSearch>
        <button onClick={() => setRevision((value) => value + 1)}>Remount destination</button>
        <SettingsSearchDestination key={revision}>
          {section === "general" ? <div data-setting-id="settings.appearance.theme">Theme</div> : null}
        </SettingsSearchDestination>
      </SettingsSearchProvider>;
    }
    render(<Harness />);
    const input = screen.getByRole("combobox");
    fireEvent.change(input, { target: { value: "Theme" } });
    fireEvent.keyDown(input, { key: "Enter" });
    await waitFor(() => expect(document.activeElement?.getAttribute("data-setting-id")).toBe("settings.appearance.theme"));
    const remount = screen.getByRole("button", { name: "Remount destination" });
    remount.focus(); fireEvent.click(remount);
    await new Promise((resolve) => window.setTimeout(resolve, 30));
    expect(document.activeElement).toBe(remount);
  });

});
