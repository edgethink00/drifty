// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { LocalizationTestProvider } from "../localization/LocalizationContext";
import { PET_OUTING_PREFERENCE_STORAGE_KEY } from "../pet-mode/petOutingPreference";
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

  it("persists outings separately from visibility and automatic close", () => {
    const { props, unmount } = renderPet();
    fireEvent.click(screen.getByRole("switch", { name: "화면 밖으로 산책 허용" }));
    expect(window.localStorage.getItem(PET_OUTING_PREFERENCE_STORAGE_KEY)).toBe("0");
    expect(props.onEnabledChange).not.toHaveBeenCalled();
    unmount();
    renderPet();
    expect(screen.getByRole("switch", { name: "화면 밖으로 산책 허용" }).getAttribute("aria-checked")).toBe("false");
  });

  it("changes shared automatic close while the pet is off and opens alert details", () => {
    const { props } = renderPet({ enabled: false, automaticCloseEnabled: true });
    const toggle = screen.getByRole("switch", { name: "딴짓 탭·앱 자동 닫기" });
    expect(toggle.getAttribute("aria-checked")).toBe("true");
    fireEvent.click(toggle);
    expect(props.onAutomaticCloseChange).toHaveBeenCalledWith(false);
    fireEvent.click(screen.getByRole("button", { name: "알림 시점·문구 설정" }));
    expect(props.onOpenAlerts).toHaveBeenCalledTimes(1);
    expect(props.onEnabledChange).not.toHaveBeenCalled();
  });

  it("keeps selected appearance visible while off and connects existing controls", () => {
    const { props } = renderPet({ coat: "charcoal", size: 75 });
    expect(screen.getByRole("img", { name: "외형 미리보기 · 75%" })).toBeTruthy();
    expect(screen.getByRole("radio", { name: "차콜" }).getAttribute("aria-checked")).toBe("true");
    fireEvent.click(screen.getByRole("radio", { name: "회색" }));
    fireEvent.click(screen.getByRole("radio", { name: "125%" }));
    expect(props.onCoatChange).toHaveBeenCalledWith("grey");
    expect(props.onSizeChange).toHaveBeenCalledWith(125);
  });
});
