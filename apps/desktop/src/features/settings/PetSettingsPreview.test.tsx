// @vitest-environment jsdom
import { act, cleanup, render } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { LocalizationTestProvider } from "../localization/LocalizationContext";
import { PetSettingsPreview } from "./PetSettingsPreview";

const preview = (enabled: boolean, coat: "ivory" | "charcoal" = "ivory", size: 50 | 125 = 50) =>
  <LocalizationTestProvider language="ko"><PetSettingsPreview enabled={enabled} coat={coat} size={size} /></LocalizationTestProvider>;

describe("PetSettingsPreview", () => {
  afterEach(() => { cleanup(); vi.useRealTimers(); vi.unstubAllGlobals(); });
  it("greets only when enabled, preserves its deadline through appearance changes, and cancels on disable", () => {
    vi.useFakeTimers();
    const { container, rerender } = render(preview(true));
    expect(container.querySelector('[data-phase="happy"]')).toBeNull();
    rerender(preview(false));
    expect(container.querySelector('.pet-mode-cat')).toBeNull();
    rerender(preview(true));
    expect(container.querySelector('[data-phase="happy"]')).not.toBeNull();
    act(() => vi.advanceTimersByTime(700));
    rerender(preview(true, "charcoal", 125));
    const stage = container.querySelector<HTMLElement>('.pet-settings-preview__stage')!;
    expect(stage.style.getPropertyValue('--pet-fur')).toBe('#33332f');
    expect(stage.style.getPropertyValue('--pet-size-scale')).toBe('1.25');
    act(() => vi.advanceTimersByTime(500));
    expect(container.querySelector('[data-phase="idle"]')).not.toBeNull();
    rerender(preview(false)); rerender(preview(true)); rerender(preview(false));
    act(() => vi.advanceTimersByTime(1200));
    expect(container.querySelector('.pet-mode-cat')).toBeNull();
  });
  it("respects reduced motion when enabled", () => {
    vi.stubGlobal('matchMedia', () => ({ matches: true }));
    const { container, rerender } = render(preview(false));
    rerender(preview(true));
    expect(container.querySelector('[data-phase="happy"]')).toBeNull();
    expect(container.querySelector('[data-phase="idle"]')).not.toBeNull();
  });
});
