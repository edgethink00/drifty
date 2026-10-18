// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { useState } from "react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { LocalizationTestProvider } from "../localization/LocalizationContext";
import { PET_MODE_COAT_PREVIEW_STORAGE_KEY, type PetModeCoat } from "../pet-mode/petModeData";
import type { ProLooksAccess } from "../pro-looks/proLooks";
import { ProLooksProvider, useProLooksController } from "../pro-looks/useProLooksController";
import { PetCoatPicker } from "./PetCoatPicker";

const signIn = vi.fn();
function Harness({ access, initial = "ivory", show = true }: { readonly access: ProLooksAccess; readonly initial?: PetModeCoat; readonly show?: boolean }) {
  const [coat, setCoat] = useState<PetModeCoat>(initial);
  const looks = useProLooksController({ access, appIconsSupported: false, coat, setCoat, flowOpen: false,
    requestSignIn: signIn, startTrial: vi.fn(async () => undefined), openProSheet: vi.fn(), openAccountSettings: vi.fn() });
  return <LocalizationTestProvider language="en"><ProLooksProvider value={looks}>
    {show ? <PetCoatPicker value={coat} onChange={setCoat} /> : null}<output data-testid="saved-skin">{coat}</output>
  </ProLooksProvider></LocalizationTestProvider>;
}
const PRO: ProLooksAccess = { state: "open", trialEndsAt: null, trialing: false };
const dialog = () => within(screen.getByRole("dialog", { name: "Skin" }));
beforeEach(() => { window.localStorage.clear(); signIn.mockClear(); });
afterEach(cleanup);

it("keeps five representatives and More, replacing only the fifth slot for a chosen non-representative", async () => {
  render(<Harness access={PRO} initial="denim" />);
  expect(screen.getAllByRole("radio").map(b => b.getAttribute("aria-label"))).toEqual(["Ivory","Grey","Honey","Mist Blue","Denim"]);
  fireEvent.click(screen.getByRole("button", { name: "More" }));
  expect(dialog().getAllByRole("radio")).toHaveLength(32);
  fireEvent.click(dialog().getByRole("radio", { name: "Forest" }));
  expect(screen.getByTestId("saved-skin").textContent).toBe("forest");
  fireEvent.click(dialog().getByRole("button", { name: "Close" }));
  await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
  expect(screen.getAllByRole("radio").map(b => b.getAttribute("aria-label"))).toEqual(["Ivory","Grey","Honey","Mist Blue","Forest"]);
});

it("lets Pro create a bounded custom skin, collapsing the editor before closing with Escape", async () => {
  render(<Harness access={PRO} />);
  fireEvent.click(screen.getByRole("button", { name: "More" }));
  fireEvent.click(dialog().getByRole("button", { name: "Custom" }));
  fireEvent.change(dialog().getByRole("slider", { name: "Hue" }), { target: { value: "194" } });
  fireEvent.change(dialog().getByRole("slider", { name: "Lightness" }), { target: { value: "69" } });
  expect(screen.getByTestId("saved-skin").textContent).toBe("custom-194-69");
  fireEvent.keyDown(window, { key: "Escape" });
  expect(dialog().getByRole("button", { name: "Custom" }).getAttribute("aria-expanded")).toBe("false");
  expect(dialog().queryByRole("slider")).toBeNull();
  fireEvent.keyDown(window, { key: "Escape" });
  await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
  expect(screen.getByTestId("saved-skin").textContent).toBe("custom-194-69");
});

it("previews guest custom changes, never saves them, and clears the preview on close", async () => {
  render(<Harness access={{ state: "guest" }} />);
  fireEvent.click(screen.getByRole("button", { name: "More" }));
  fireEvent.click(dialog().getByRole("button", { name: "Custom" }));
  fireEvent.change(dialog().getByRole("slider", { name: "Hue" }), { target: { value: "240" } });
  expect(screen.getByTestId("saved-skin").textContent).toBe("ivory");
  expect(window.localStorage.getItem(PET_MODE_COAT_PREVIEW_STORAGE_KEY)).toBe("custom-240-74");
  expect(dialog().getByText("Trying on")).toBeTruthy();
  expect(dialog().getAllByRole("button").filter(b => b.classList.contains("modal-btn"))).toHaveLength(1);
  fireEvent.click(dialog().getByRole("button", { name: "Close" }));
  await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
  expect(window.localStorage.getItem(PET_MODE_COAT_PREVIEW_STORAGE_KEY)).toBeNull();
  expect(screen.getByTestId("saved-skin").textContent).toBe("ivory");
});

it("uses arrow navigation across preset groups without changing the custom editor", () => {
  render(<Harness access={PRO} />);
  fireEvent.click(screen.getByRole("button", { name: "More" }));
  const last = dialog().getByRole("radio", { name: "Taupe" });
  last.focus();
  fireEvent.keyDown(last, { key: "ArrowRight" });
  expect(screen.getByTestId("saved-skin").textContent).toBe("peach");
  expect(document.activeElement).toBe(dialog().getByRole("radio", { name: "Peach Milk" }));
});

it("keeps free choices usable while account access is still loading", () => {
  render(<Harness access={{ state: "unknown" }} />);
  fireEvent.click(screen.getByRole("radio", { name: "Grey" }));
  expect(screen.getByTestId("saved-skin").textContent).toBe("grey");
  expect(screen.queryByRole("dialog")).toBeNull();
  fireEvent.click(screen.getByRole("radio", { name: "Honey" }));
  expect(screen.getByTestId("saved-skin").textContent).toBe("grey");
  expect(dialog().getByRole("status").textContent).toContain("Checking your plan");
  expect(window.localStorage.getItem(PET_MODE_COAT_PREVIEW_STORAGE_KEY)).toBeNull();
});

it("hands a guest try-on to sign-in while closing the picker without saving", async () => {
  render(<Harness access={{ state: "guest" }} />);
  fireEvent.click(screen.getByRole("button", { name: "More" }));
  fireEvent.click(dialog().getByRole("radio", { name: "Honey · Pro" }));
  fireEvent.click(dialog().getByRole("button", { name: "Sign in and try free for 7 days" }));
  await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
  expect(signIn).toHaveBeenCalledTimes(1);
  expect(window.localStorage.getItem(PET_MODE_COAT_PREVIEW_STORAGE_KEY)).toBe("honey");
  expect(screen.getByTestId("saved-skin").textContent).toBe("ivory");
});

it("ends an unsaved try-on when leaving the pet settings row", () => {
  const access: ProLooksAccess = { state: "guest" };
  const view = render(<Harness access={access} />);
  fireEvent.click(screen.getByRole("button", { name: "More" }));
  fireEvent.click(dialog().getByRole("radio", { name: "Honey · Pro" }));
  expect(window.localStorage.getItem(PET_MODE_COAT_PREVIEW_STORAGE_KEY)).toBe("honey");
  view.rerender(<Harness access={access} show={false} />);
  expect(window.localStorage.getItem(PET_MODE_COAT_PREVIEW_STORAGE_KEY)).toBeNull();
  expect(screen.getByTestId("saved-skin").textContent).toBe("ivory");
});

it("opens the editor at an externally restored saved custom color", () => {
  const onChange = vi.fn();
  const renderPicker = (value: PetModeCoat) => <LocalizationTestProvider language="en"><PetCoatPicker value={value} onChange={onChange} /></LocalizationTestProvider>;
  const view = render(renderPicker("ivory"));
  view.rerender(renderPicker("custom-194-69"));
  fireEvent.click(screen.getByRole("button", { name: "More" }));
  fireEvent.click(dialog().getByRole("button", { name: "Custom" }));
  expect((dialog().getByRole("slider", { name: "Hue" }) as HTMLInputElement).value).toBe("194");
  expect((dialog().getByRole("slider", { name: "Lightness" }) as HTMLInputElement).value).toBe("69");
});
