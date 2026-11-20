// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { LocalizationTestProvider } from "../localization/LocalizationContext";
import { PET_OUTING_PREFERENCE_STORAGE_KEY } from "../pet-mode/petOutingPreference";
import { PET_PRESENCE_MODE_STORAGE_KEY } from "../pet-mode/petPresenceMode";
import { PET_NAME_STORAGE_KEY } from "../pet-mode/petName";
import { PetSettingsSection } from "./PetSettingsSection";

function renderPet(overrides: Partial<Parameters<typeof PetSettingsSection>[0]> = {}) {
  const props = { enabled: true, coat: "ivory" as const, size: 100 as const,
    automaticCloseEnabled: false, driftAlertsEnabled: true, onAutomaticCloseChange: vi.fn(), onEnabledChange: vi.fn(), onCoatChange: vi.fn(),
    onSizeChange: vi.fn(), onOpenAlerts: vi.fn(), ...overrides };
  const view = render(<LocalizationTestProvider language="ko"><PetSettingsSection {...props} /></LocalizationTestProvider>);
  return { ...view, props };
}

describe("PetSettingsSection", () => {
  beforeEach(() => window.localStorage.clear());
  afterEach(cleanup);

  it("retires the hover switch for existing users while preserving their auto-close setting", () => {
    window.localStorage.setItem("drifty.pet.showHoverControls.v1", "1");
    const { props } = renderPet({ automaticCloseEnabled: true });
    expect(screen.queryByRole("switch", { name: "마우스를 올리면 빠른 제어 표시" })).toBeNull();
    expect(screen.getByRole("switch", { name: "데스크톱 펫의 딴짓 자동 닫기 전환" }).getAttribute("aria-checked")).toBe("true");
    expect(props.onAutomaticCloseChange).not.toHaveBeenCalled();
  });

  it("persists outings separately from visibility and automatic close", () => {
    const { props, unmount } = renderPet();
    fireEvent.click(screen.getByRole("switch", { name: "화면 밖으로 산책 허용" }));
    expect(window.localStorage.getItem(PET_OUTING_PREFERENCE_STORAGE_KEY)).toBe("0");
    expect(props.onEnabledChange).not.toHaveBeenCalled();
    unmount();
    renderPet();
    expect(screen.getByRole("switch", { name: "화면 밖으로 산책 허용" }).getAttribute("aria-checked")).toBe("false");
  });

  it("keeps the show toggle and adds a presence-style select beneath it", () => {
    const { props } = renderPet();
    const select = screen.getByRole("combobox", { name: "나타나는 방식" });
    expect(select.textContent).toContain("항상 함께");

    fireEvent.click(select);
    fireEvent.click(screen.getByRole("option", { name: "딴짓할 때만" }));
    expect(window.localStorage.getItem(PET_PRESENCE_MODE_STORAGE_KEY)).toBe("drift_only");
    expect(props.onEnabledChange).not.toHaveBeenCalled();
    expect(screen.getByRole("combobox", { name: "나타나는 방식" }).textContent).toContain("딴짓할 때만");
    // Outings are meaningless while off screen is already the resting state.
    const outings = screen.getByRole("switch", { name: "화면 밖으로 산책 허용" }) as HTMLButtonElement;
    expect(outings.disabled).toBe(true);

    fireEvent.click(screen.getByRole("switch", { name: "데스크톱 펫 표시 전환" }));
    expect(props.onEnabledChange).toHaveBeenCalledWith(false);
  });

  it("keeps the presence style visible but disabled while the pet is off", () => {
    window.localStorage.setItem(PET_PRESENCE_MODE_STORAGE_KEY, "drift_only");
    renderPet({ enabled: false });
    const select = screen.getByRole("combobox", { name: "나타나는 방식" }) as HTMLButtonElement;
    expect(select.textContent).toContain("딴짓할 때만");
    expect(select.disabled).toBe(true);
    // A disabled select must not open a listbox over an unusable control.
    fireEvent.click(select);
    expect(screen.queryByRole("listbox")).toBeNull();
    // Outings stay editable while off; the style has no effect until on.
    expect((screen.getByRole("switch", { name: "화면 밖으로 산책 허용" }) as HTMLButtonElement).disabled).toBe(false);
  });

  it("changes shared automatic close while the pet is off and opens alert details", () => {
    const { props } = renderPet({ enabled: false, automaticCloseEnabled: true });
    const toggle = screen.getByRole("switch", { name: "데스크톱 펫의 딴짓 자동 닫기 전환" });
    expect(toggle.getAttribute("aria-checked")).toBe("true");
    fireEvent.click(toggle);
    expect(props.onAutomaticCloseChange).toHaveBeenCalledWith(false);
    fireEvent.click(screen.getByRole("button", { name: "알림 시점과 문구 설정" }));
    expect(props.onOpenAlerts).toHaveBeenCalledTimes(1);
    expect(props.onEnabledChange).not.toHaveBeenCalled();
  });

  it("shows the selected size and coat and connects existing controls", () => {
    const { props } = renderPet({ coat: "charcoal", size: 75 });
    expect(screen.getByRole("img", { name: "외형 미리보기 · 75% · 차콜" })).toBeTruthy();
    expect(screen.getByRole("radio", { name: "차콜" }).getAttribute("aria-checked")).toBe("true");
    fireEvent.click(screen.getByRole("radio", { name: "회색" }));
    fireEvent.click(screen.getByRole("radio", { name: "125%" }));
    expect(props.onCoatChange).toHaveBeenCalledWith("grey");
    expect(props.onSizeChange).toHaveBeenCalledWith(125);
  });

  it("keeps the cat visible and appearance editable while the pet is off", () => {
    const { props } = renderPet({ enabled: false, coat: "charcoal", size: 75 });
    expect(screen.getByRole("img", { name: "꺼져 있음 · 75% · 차콜" })).toBeTruthy();
    expect(document.querySelector(".pet-settings-preview.is-off .pet-mode-cat")).toBeTruthy();
    fireEvent.click(screen.getByRole("radio", { name: "회색" }));
    fireEvent.click(screen.getByRole("radio", { name: "125%" }));
    expect(props.onCoatChange).toHaveBeenCalledWith("grey");
    expect(props.onSizeChange).toHaveBeenCalledWith(125);
  });

  it("names the cat here too: saves on Enter or leaving the field, restores on Escape, and an empty field removes the name", () => {
    renderPet({ enabled: false });
    const field = screen.getByRole("textbox", { name: /^이름/ }) as HTMLInputElement;
    expect(field.value).toBe("");
    expect(field.placeholder).toBe("고양이");
    fireEvent.focus(field);
    fireEvent.change(field, { target: { value: "  보리  " } });
    fireEvent.keyDown(field, { key: "Enter" });
    fireEvent.blur(field);
    expect(window.localStorage.getItem(PET_NAME_STORAGE_KEY)).toBe("보리");
    expect(field.value).toBe("보리");

    fireEvent.focus(field);
    fireEvent.change(field, { target: { value: "콩" } });
    fireEvent.keyDown(field, { key: "Escape" });
    fireEvent.blur(field);
    expect(window.localStorage.getItem(PET_NAME_STORAGE_KEY)).toBe("보리");
    expect(field.value).toBe("보리");

    fireEvent.focus(field);
    fireEvent.change(field, { target: { value: "" } });
    fireEvent.blur(field);
    expect(window.localStorage.getItem(PET_NAME_STORAGE_KEY)).toBeNull();
  });
});
