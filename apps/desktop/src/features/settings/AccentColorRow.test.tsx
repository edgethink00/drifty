// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { useState } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { darkAccentTone } from "../../lib/accentTone";
import { LocalizationTestProvider } from "../localization/LocalizationContext";
import type { PetModeCoat } from "../pet-mode/petModeData";
import type { ProLooksAccess } from "../pro-looks/proLooks";
import { ProLooksProvider, useProLooksController } from "../pro-looks/useProLooksController";
import { AccentColorRow } from "./AccentColorRow";

vi.mock("../../lib/api/appIconClient", async (importActual) => ({
  ...(await importActual<typeof import("../../lib/api/appIconClient")>()),
  getAppIconVariant: vi.fn(async () => "classic"),
  setAppIconVariant: vi.fn(async (variant: string) => variant),
  previewAppIcon: vi.fn(async () => undefined),
}));

const PRO: ProLooksAccess = { state: "open", trialEndsAt: null, trialing: false };
const GUEST: ProLooksAccess = { state: "guest" };
const LAPSED: ProLooksAccess = { state: "upgrade" };

function Harness({ access, initialAccent, showRow = true }: { readonly access: ProLooksAccess; readonly initialAccent?: string; readonly showRow?: boolean }) {
  const [accent, setAccent] = useState<string | undefined>(initialAccent);
  const [coat, setCoat] = useState<PetModeCoat>("ivory");
  const looks = useProLooksController({
    access, appIconsSupported: false, coat, setCoat, flowOpen: false,
    accent, setAccent: (next) => setAccent(next ?? undefined),
    requestSignIn: vi.fn(), startTrial: vi.fn(async () => undefined), openProSheet: vi.fn(), openAccountSettings: vi.fn(),
  });
  return (
    <LocalizationTestProvider language="en">
      <ProLooksProvider value={looks}>
        {showRow ? <AccentColorRow accent={accent} onAccentChange={setAccent} onAccentReset={() => setAccent(undefined)} /> : null}
        <output data-testid="saved">{accent ?? "moss"}</output>
        <output data-testid="tried">{looks.preview?.kind === "accent" ? looks.preview.id : ""}</output>
      </ProLooksProvider>
    </LocalizationTestProvider>
  );
}

const saved = () => screen.getByTestId("saved").textContent;
const tried = () => screen.getByTestId("tried").textContent;
const radioNames = () => within(screen.getByRole("radiogroup", { name: "Accent" })).getAllByRole("radio").map((radio) => radio.getAttribute("aria-label"));

beforeEach(() => window.localStorage.clear());
afterEach(cleanup);

describe("Accent color row", () => {
  it("spreads Moss and Charcoal first and free, then 18 Pro colors and More colors, without Fern and Coral", () => {
    const view = render(<Harness access={GUEST} />);
    expect(radioNames()).toEqual([
      "Moss", "Charcoal", "Teal · Pro", "Cyan · Pro", "Blue · Pro", "Indigo · Pro", "Violet · Pro", "Plum · Pro",
      "Rose · Pro", "Berry · Pro", "Wine · Pro", "Clay · Pro", "Rust · Pro", "Copper · Pro", "Ochre · Pro",
      "Gold · Pro", "Olive · Pro", "Sand · Pro", "Stone · Pro", "Slate · Pro",
    ]);
    expect(screen.getByRole("button", { name: "More colors · Pro" })).toBeTruthy();
    expect(view.container.querySelectorAll(".pro-look-lock")).toHaveLength(19);
    expect(screen.getByRole("radio", { name: "Moss" }).getAttribute("aria-checked")).toBe("true");
    // In dark mode a circle shows the lighter tone the app paints.
    expect(screen.getByRole("radio", { name: "Plum · Pro" }).style.getPropertyValue("--swatch-color-dark")).toBe(darkAccentTone("#9b5b91"));
  });

  it("tries a locked color on without saving it, follows the next locked pick, and goes back on Escape", () => {
    render(<Harness access={GUEST} />);
    fireEvent.click(screen.getByRole("radio", { name: "Plum · Pro" }));
    const bubble = screen.getByRole("dialog", { name: "Previewing the ‘Plum’ accent" });
    expect(within(bubble).getByText("Sign in to try every accent color free for 7 days.")).toBeTruthy();
    expect(within(bubble).getByText("Close this to go back to your color.")).toBeTruthy();
    expect(tried()).toBe("#9b5b91");
    expect(saved()).toBe("moss");
    expect(screen.getByRole("radio", { name: "Plum · Pro" }).className).toContain("is-trying-on");

    fireEvent.click(screen.getByRole("radio", { name: "Teal · Pro" }));
    expect(screen.getAllByRole("dialog")).toHaveLength(1);
    expect(screen.getByRole("dialog", { name: "Previewing the ‘Teal’ accent" })).toBeTruthy();
    expect(tried()).toBe("#2f7f78");

    fireEvent.keyDown(document, { key: "Escape" });
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(tried()).toBe("");
    expect(saved()).toBe("moss");
  });

  it("ends a try-on when the row goes away, so it never follows the person out of Settings", () => {
    const view = render(<Harness access={GUEST} />);
    fireEvent.click(screen.getByRole("radio", { name: "Plum · Pro" }));
    expect(tried()).toBe("#9b5b91");
    view.rerender(<Harness access={GUEST} showRow={false} />);
    expect(tried()).toBe("");
    expect(saved()).toBe("moss");
  });

  it("saves a free color at once, and Moss goes back to the default", () => {
    render(<Harness access={GUEST} />);
    fireEvent.click(screen.getByRole("radio", { name: "Charcoal" }));
    expect(saved()).toBe("#4d4b45");
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(screen.getByRole("radio", { name: "Charcoal" }).getAttribute("aria-checked")).toBe("true");
    fireEvent.click(screen.getByRole("radio", { name: "Moss" }));
    expect(saved()).toBe("moss");
  });

  it("keeps More colors behind Pro and opens the color picker once Pro is on", () => {
    const view = render(<Harness access={GUEST} />);
    fireEvent.click(screen.getByRole("button", { name: "More colors · Pro" }));
    const bubble = screen.getByRole("dialog", { name: "Your own accent colors are Pro" });
    expect(within(bubble).getByRole("button", { name: "Close" })).toBeTruthy();
    expect(tried()).toBe("");
    view.unmount();

    render(<Harness access={PRO} />);
    expect(screen.queryAllByRole("radio").filter((radio) => /· Pro$/.test(radio.getAttribute("aria-label") ?? ""))).toHaveLength(0);
    fireEvent.change(screen.getByLabelText("More colors"), { target: { value: "#123456" } });
    expect(saved()).toBe("#123456");
    expect(screen.getByRole("radio", { name: "Your own color" }).getAttribute("aria-checked")).toBe("true");
  });

  it("keeps an accent used before accents were locked, even one left out of the row", () => {
    render(<Harness access={LAPSED} initialAccent="#4f751e" />);
    expect(screen.getByRole("radio", { name: "Fern" }).getAttribute("aria-checked")).toBe("true");
    fireEvent.click(screen.getByRole("radio", { name: "Moss" }));
    expect(saved()).toBe("moss");
    fireEvent.click(screen.getByRole("radio", { name: "Fern" }));
    expect(saved()).toBe("#4f751e");
    expect(screen.getByRole("radio", { name: "Plum · Pro" })).toBeTruthy();
  });

  it("puts a Pro accent away when Pro is known to have ended and brings it back with Pro", async () => {
    window.localStorage.setItem("drifty.accent.lockStarted", "1");
    const view = render(<Harness access={LAPSED} initialAccent="#9b5b91" />);
    await waitFor(() => expect(saved()).toBe("moss"));
    expect(screen.getByText("Pro ended, so the accent is back to Moss. Start Pro and ‘Plum’ comes back.")).toBeTruthy();
    view.rerender(<Harness access={PRO} initialAccent="#9b5b91" />);
    await waitFor(() => expect(saved()).toBe("#9b5b91"));
  });
});
