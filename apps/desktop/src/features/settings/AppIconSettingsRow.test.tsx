// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { useState, type ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { HostPlatform } from "../../lib/api/accessibilityClient";
import { LocalizationTestProvider } from "../localization/LocalizationContext";
import type { PetModeCoat } from "../pet-mode/petModeData";
import type { ProLooksAccess } from "../pro-looks/proLooks";
import { ProLooksProvider, useProLooksController, type ProLooksControllerInput } from "../pro-looks/useProLooksController";
import { AppIconSettingsRow } from "./AppIconSettingsRow";
import { AppearanceSettingsBlock } from "./AppearanceSettingsBlock";

const nativeIcon = vi.hoisted(() => ({
  get: vi.fn<() => Promise<string>>(),
  set: vi.fn<(variant: string) => Promise<string>>(),
  preview: vi.fn<(variant: string | null) => Promise<void>>(),
}));

vi.mock("../../lib/api/appIconClient", async (importActual) => ({
  ...(await importActual<typeof import("../../lib/api/appIconClient")>()),
  getAppIconVariant: nativeIcon.get,
  setAppIconVariant: nativeIcon.set,
  previewAppIcon: nativeIcon.preview,
}));

const PRO: ProLooksAccess = { state: "open", trialEndsAt: null, trialing: false };
const TRIAL: ProLooksAccess = { state: "open", trialEndsAt: null, trialing: true };
const TRIAL_ENDING_LATER: ProLooksAccess = { state: "open", trialEndsAt: new Date(Date.now() + 40 * 86_400_000).toISOString(), trialing: true };

type Flow = Pick<ProLooksControllerInput, "requestSignIn" | "startTrial" | "openProSheet" | "openAccountSettings">;

function flowSpies() {
  return {
    requestSignIn: vi.fn(),
    startTrial: vi.fn(() => Promise.resolve()),
    openProSheet: vi.fn(),
    openAccountSettings: vi.fn(),
  } satisfies Flow;
}

function Looks({ access, flow, flowOpen, children }: {
  readonly access: ProLooksAccess;
  readonly flow: Flow;
  readonly flowOpen: boolean;
  readonly children: ReactNode;
}) {
  const [coat, setCoat] = useState<PetModeCoat>("ivory");
  const looks = useProLooksController({ access, appIconsSupported: true, coat, setCoat, flowOpen, ...flow });
  return <ProLooksProvider value={looks}>{children}</ProLooksProvider>;
}

function renderRow(access: ProLooksAccess, flow = flowSpies()) {
  const ui = (next: ProLooksAccess, flowOpen: boolean) => (
    <LocalizationTestProvider language="en">
      <Looks access={next} flow={flow} flowOpen={flowOpen}><AppIconSettingsRow /></Looks>
    </LocalizationTestProvider>
  );
  const view = render(ui(access, false));
  return { flow, view, rerender: (next: ProLooksAccess, flowOpen = false) => view.rerender(ui(next, flowOpen)) };
}

function checked(name: string) {
  return screen.getByRole("radio", { name }).getAttribute("aria-checked");
}

beforeEach(() => {
  window.localStorage.clear();
  nativeIcon.get.mockResolvedValue("classic");
  nativeIcon.set.mockImplementation(async (variant) => variant);
  nativeIcon.preview.mockResolvedValue(undefined);
});

afterEach(() => {
  cleanup();
  nativeIcon.get.mockReset();
  nativeIcon.set.mockReset();
  nativeIcon.preview.mockReset();
});

describe("App icon setting", () => {
  it("shows the icon saved on this Mac and switches the Dock icon when another is picked", async () => {
    nativeIcon.get.mockResolvedValue("cat-charcoal");
    renderRow(PRO);

    expect(screen.getAllByRole("radio").map((radio) => radio.getAttribute("aria-label"))).toEqual([
      "Classic", "Midnight", "Plum", "Flow", "Retro",
      "Peek", "Cat face", "Window walk", "Ivory cat", "Charcoal cat", "Plum cat",
    ]);
    await waitFor(() => expect(checked("Charcoal cat")).toBe("true"));

    fireEvent.click(screen.getByRole("radio", { name: "Midnight" }));
    expect(nativeIcon.set).toHaveBeenCalledWith("midnight");
    expect(checked("Midnight")).toBe("true");
    expect(checked("Charcoal cat")).toBe("false");

    fireEvent.click(screen.getByRole("radio", { name: "Midnight" }));
    expect(nativeIcon.set).toHaveBeenCalledTimes(1);
  });

  it("returns to the previous icon and says so when the change fails", async () => {
    nativeIcon.get.mockResolvedValue("cat-charcoal");
    nativeIcon.set.mockRejectedValue(new Error("Could not save the app icon preference: disk full"));
    renderRow(PRO);
    await waitFor(() => expect(checked("Charcoal cat")).toBe("true"));

    fireEvent.click(screen.getByRole("radio", { name: "Plum" }));
    const alert = await screen.findByRole("alert");
    expect(alert.textContent).toBe("Couldn't change the app icon. Try again.");
    expect(alert.getAttribute("title")).toContain("disk full");
    expect(checked("Charcoal cat")).toBe("true");
    expect(checked("Plum")).toBe("false");
  });

  it("is offered only on macOS", async () => {
    const renderAppearance = (hostPlatform: HostPlatform) => render(
      <LocalizationTestProvider language="en">
        <Looks access={PRO} flow={flowSpies()} flowOpen={false}>
          <AppearanceSettingsBlock
            appThemeColorOverrides={{}}
            theme="light"
            hostPlatform={hostPlatform}
            windowsBlurEnabled={false}
            onWindowsBlurEnabledChange={vi.fn()}
            previousDashboardLayout={false}
            onPreviousDashboardLayoutChange={vi.fn()}
            onAppThemeColorChange={vi.fn()}
            onAppThemeColorReset={vi.fn()}
            onThemeChange={vi.fn()}
          />
        </Looks>
      </LocalizationTestProvider>,
    );

    renderAppearance("windows");
    expect(screen.queryByRole("radiogroup", { name: "App icon" })).toBeNull();
    cleanup();

    renderAppearance("macos");
    expect(screen.getByRole("radiogroup", { name: "App icon" })).toBeTruthy();
    await waitFor(() => expect(checked("Classic")).toBe("true"));
  });
});

describe("App icon setting without Pro", () => {
  it("opens every icon during a trial without a note about the plan under the picker", async () => {
    const { view } = renderRow(TRIAL_ENDING_LATER);
    await waitFor(() => expect(checked("Classic")).toBe("true"));
    expect(view.container.querySelectorAll(".pro-look-lock")).toHaveLength(0);
    // The trial and its end are shown once, in Settings › Account.
    expect(view.container.querySelector(".pro-look-note")).toBeNull();
    expect(screen.queryByText(/trial/i)).toBeNull();
  });

  it("locks every icon after the first two with an always-visible corner lock and leaves Classic and Midnight free", async () => {
    const { view } = renderRow({ state: "upgrade" });
    await waitFor(() => expect(checked("Classic")).toBe("true"));
    expect(screen.getAllByRole("radio").map((radio) => radio.getAttribute("aria-label"))).toEqual([
      "Classic", "Midnight", "Plum · Pro", "Flow · Pro", "Retro · Pro",
      "Peek · Pro", "Cat face · Pro", "Window walk · Pro", "Ivory cat · Pro", "Charcoal cat · Pro", "Plum cat · Pro",
    ]);
    expect(view.container.querySelectorAll(".pro-look-lock")).toHaveLength(9);

    fireEvent.click(screen.getByRole("radio", { name: "Midnight" }));
    expect(nativeIcon.set).toHaveBeenCalledWith("midnight");
    nativeIcon.set.mockClear();
    fireEvent.click(screen.getByRole("radio", { name: "Retro · Pro" }));
    expect(nativeIcon.set).not.toHaveBeenCalled();
    expect(nativeIcon.preview).toHaveBeenCalledWith("retro");
  });

  it("tries a locked icon on in the Dock while its bubble is open and puts the saved icon back on Go back", async () => {
    renderRow({ state: "upgrade" });
    await waitFor(() => expect(checked("Classic")).toBe("true"));

    fireEvent.click(screen.getByRole("radio", { name: "Peek · Pro" }));
    const bubble = screen.getByRole("dialog", { name: "Previewing ‘Peek’ in the Dock" });
    expect(within(bubble).getByText("Pro includes every app icon.")).toBeTruthy();
    expect(within(bubble).getByText("Close this to go back to your icon.")).toBeTruthy();
    await waitFor(() => expect(nativeIcon.preview).toHaveBeenLastCalledWith("peek"));
    expect(nativeIcon.set).not.toHaveBeenCalled();
    expect(checked("Classic")).toBe("true");

    fireEvent.click(within(bubble).getByRole("button", { name: "Go back" }));
    expect(screen.queryByRole("dialog")).toBeNull();
    await waitFor(() => expect(nativeIcon.preview).toHaveBeenLastCalledWith(null));
    expect(nativeIcon.set).not.toHaveBeenCalled();
  });

  it("closes the try-on with Escape", async () => {
    renderRow({ state: "upgrade" });
    await waitFor(() => expect(checked("Classic")).toBe("true"));
    fireEvent.click(screen.getByRole("radio", { name: "Cat face · Pro" }));
    await waitFor(() => expect(nativeIcon.preview).toHaveBeenLastCalledWith("omega"));
    fireEvent.keyDown(document, { key: "Escape" });
    expect(screen.queryByRole("dialog")).toBeNull();
    await waitFor(() => expect(nativeIcon.preview).toHaveBeenLastCalledWith(null));
  });

  it("signs a guest in, starts the trial and then keeps the icon that was tried on", async () => {
    const { flow, rerender } = renderRow({ state: "guest" });
    await waitFor(() => expect(checked("Classic")).toBe("true"));
    fireEvent.click(screen.getByRole("radio", { name: "Peek · Pro" }));
    const bubble = screen.getByRole("dialog");
    expect(within(bubble).getByText("Sign in to try every Pro icon free for 7 days.")).toBeTruthy();
    fireEvent.click(within(bubble).getByRole("button", { name: "Sign in and try free for 7 days" }));
    expect(flow.requestSignIn).toHaveBeenCalledTimes(1);

    rerender({ state: "guest" }, true);
    rerender({ state: "unknown" });
    rerender({ state: "trial-available" });
    await waitFor(() => expect(flow.startTrial).toHaveBeenCalledTimes(1));
    rerender({ state: "trial-available" }, true);
    expect(nativeIcon.preview).not.toHaveBeenLastCalledWith(null);
    rerender(TRIAL);
    await waitFor(() => expect(nativeIcon.set).toHaveBeenCalledWith("peek"));
    expect(checked("Peek")).toBe("true");
  });

  it("starts the trial straight from the bubble for an account that has not used it", async () => {
    const { flow, rerender } = renderRow({ state: "trial-available" });
    await waitFor(() => expect(checked("Classic")).toBe("true"));
    fireEvent.click(screen.getByRole("radio", { name: "Plum cat · Pro" }));
    fireEvent.click(within(screen.getByRole("dialog")).getByRole("button", { name: "Start 7-day free trial" }));
    expect(flow.startTrial).toHaveBeenCalledTimes(1);
    rerender({ state: "trial-available" }, true);
    rerender(TRIAL);
    await waitFor(() => expect(nativeIcon.set).toHaveBeenCalledWith("cat-plum"));
  });

  it("opens the Pro sheet for the icon, and setting the sheet aside ends the try-on", async () => {
    const { flow, rerender } = renderRow({ state: "upgrade" });
    await waitFor(() => expect(checked("Classic")).toBe("true"));
    fireEvent.click(screen.getByRole("radio", { name: "Window walk · Pro" }));
    fireEvent.click(within(screen.getByRole("dialog")).getByRole("button", { name: "Upgrade to Pro" }));
    expect(flow.openProSheet).toHaveBeenCalledWith({ kind: "icon", id: "window" });
    expect(screen.queryByRole("dialog")).toBeNull();

    rerender({ state: "upgrade" }, true);
    expect(nativeIcon.preview).toHaveBeenLastCalledWith("window");
    rerender({ state: "upgrade" }, false);
    await waitFor(() => expect(nativeIcon.preview).toHaveBeenLastCalledWith(null));
    expect(nativeIcon.set).not.toHaveBeenCalled();
  });

  it("shows no locks while the plan is loading and answers a cat icon once it is known", async () => {
    const { view, rerender } = renderRow({ state: "unknown" });
    await waitFor(() => expect(checked("Classic")).toBe("true"));
    expect(view.container.querySelectorAll(".pro-look-lock")).toHaveLength(0);

    fireEvent.click(screen.getByRole("radio", { name: "Peek" }));
    const bubble = screen.getByRole("dialog", { name: "‘Peek’ is a Pro icon" });
    expect(within(bubble).getByText("Checking your plan. Try again in a moment.")).toBeTruthy();
    expect(within(bubble).getAllByRole("button").map((button) => button.textContent)).toEqual(["Close"]);
    expect(nativeIcon.preview).not.toHaveBeenCalled();

    rerender({ state: "upgrade" });
    expect(await screen.findByRole("dialog", { name: "Previewing ‘Peek’ in the Dock" })).toBeTruthy();
  });

  it("puts a cat icon away when Pro ends and brings it back when Pro starts again", async () => {
    nativeIcon.get.mockResolvedValue("cat-plum");
    const { rerender } = renderRow(PRO);
    await waitFor(() => expect(checked("Plum cat")).toBe("true"));

    rerender({ state: "upgrade" });
    await waitFor(() => expect(nativeIcon.set).toHaveBeenLastCalledWith("classic"));
    expect(screen.getByText("Pro ended, so the Dock icon is back to Classic. Start Pro and ‘Plum cat’ comes back.")).toBeTruthy();

    rerender(PRO);
    await waitFor(() => expect(nativeIcon.set).toHaveBeenLastCalledWith("cat-plum"));
    expect(screen.queryByText(/Pro ended/)).toBeNull();
  });
});

