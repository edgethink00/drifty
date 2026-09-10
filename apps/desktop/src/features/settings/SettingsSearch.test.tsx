// @vitest-environment jsdom
import { useState } from "react";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { SettingsSearch } from "./SettingsSearch";
import { SettingsSearchDestination, SettingsSearchProvider } from "./SettingsSearchContext";
import { SettingsCollapsibleCard } from "./SettingsCollapsibleCard";
import { LocalizationTestProvider } from "../localization/LocalizationContext";
import type { SettingsSection } from "./SettingsSidebar";
import { searchSettings, type SettingsSearchAvailability } from "./settingsSearchIndex";

const publicAvailability: SettingsSearchAvailability = { dev: false, intelligence: true, backgroundUpdates: true, signedIn: false, deviceSync: false };

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

  it("omits gated destinations from search, including Dev in production", () => {
    const enabled = { dev: true, intelligence: true, backgroundUpdates: true, signedIn: true, deviceSync: true };
    const disabled = { dev: false, intelligence: false, backgroundUpdates: false, signedIn: false, deviceSync: false };
    expect(searchSettings("Diagnostics", enabled).some((entry) => entry.section === "dev")).toBe(true);
    expect(searchSettings("Diagnostics", disabled).some((entry) => entry.section === "dev")).toBe(false);
    for (const query of ["sync", "Intelligence", "update", "delete"]) {
      expect(searchSettings(query, disabled).every((entry) => !entry.gate)).toBe(true);
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
  it("keeps a pending request across delayed navigation and consumes it before destination remount", async () => {
    vi.stubGlobal("requestAnimationFrame", (callback: FrameRequestCallback) => window.setTimeout(() => callback(0), 0));
    vi.stubGlobal("cancelAnimationFrame", (id: number) => window.clearTimeout(id));
    function Harness() {
      const [section, setSection] = useState<SettingsSection>("general");
      const [revision, setRevision] = useState(0);
      return <SettingsSearchProvider activeSection={section} availability={publicAvailability}
        onNavigate={(entry) => window.setTimeout(() => setSection(entry.section), 20)}>
        <SettingsSearch><nav /></SettingsSearch>
        <button onClick={() => setRevision((value) => value + 1)}>Remount destination</button>
        <SettingsSearchDestination key={revision}>
          {section === "appearance" ? <div data-setting-id="settings.appearance.theme">Theme</div> : null}
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
