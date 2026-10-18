// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { useState } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { BillingEntitlement } from "../billing/billingService";
import { LocalizationTestProvider } from "../localization/LocalizationContext";
import { PET_MODE_COAT_PREVIEW_STORAGE_KEY, PET_MODE_COAT_STORAGE_KEY, resolveInitialPetModeCoat, type PetModeCoat } from "../pet-mode/petModeData";
import { PetCoatPicker } from "../settings/PetCoatPicker";
import { isLookLocked, readRevertedLooks, resolveKeptAccent, resolveKeptCoat, resolveProLooksAccess, writeRevertedLooks, type ProLooksAccess } from "./proLooks";
import { ProLooksProvider, useProLooksController } from "./useProLooksController";

vi.mock("../../lib/api/appIconClient", async (importActual) => ({
  ...(await importActual<typeof import("../../lib/api/appIconClient")>()),
  getAppIconVariant: vi.fn(async () => "classic"),
  setAppIconVariant: vi.fn(async (variant: string) => variant),
  previewAppIcon: vi.fn(async () => undefined),
}));

const entitlement = (overrides: Partial<BillingEntitlement>): BillingEntitlement => ({
  plan: "individual",
  status: "locked",
  canUseApp: false,
  trialEndsAt: null,
  currentPeriodEnd: null,
  ...overrides,
});

const signedIn = { accountsConfigured: true, authStatus: "authenticated", signedIn: true, entitlementLoading: false, entitlementError: null } as const;

describe("Pro looks access", () => {
  it("opens every look for a trial, an individual plan and an organization seat", () => {
    expect(resolveProLooksAccess({ ...signedIn, entitlement: entitlement({ status: "trialing", canUseApp: true, trialEndsAt: "2026-10-20T00:00:00Z" }) }))
      .toEqual({ state: "open", trialEndsAt: "2026-10-20T00:00:00Z", trialing: true });
    expect(resolveProLooksAccess({ ...signedIn, entitlement: entitlement({ status: "active", canUseApp: true }) }).state).toBe("open");
    expect(resolveProLooksAccess({ ...signedIn, entitlement: entitlement({ status: "active", canUseApp: true, entitlementOwner: "organization" }) }).state).toBe("open");
  });

  it("tells guests, trial-eligible accounts and lapsed accounts apart", () => {
    expect(resolveProLooksAccess({ ...signedIn, signedIn: false, entitlement: null }).state).toBe("guest");
    expect(resolveProLooksAccess({ ...signedIn, accountsConfigured: false, entitlement: null }).state).toBe("guest");
    expect(resolveProLooksAccess({
      ...signedIn,
      entitlement: entitlement({ lockedReason: "billing_missing", trialActivation: { state: "available" } as BillingEntitlement["trialActivation"] }),
    }).state).toBe("trial-available");
    expect(resolveProLooksAccess({ ...signedIn, entitlement: entitlement({ lockedReason: "trial_expired" }) }).state).toBe("upgrade");
    expect(resolveProLooksAccess({ ...signedIn, entitlement: entitlement({ lockedReason: "payment_required" }) }).state).toBe("unavailable");
  });

  it("stays unknown, locking and reverting nothing, until the account and plan are known", () => {
    expect(resolveProLooksAccess({ ...signedIn, authStatus: "loading", signedIn: false, entitlement: null }).state).toBe("unknown");
    expect(resolveProLooksAccess({ ...signedIn, entitlement: null, entitlementLoading: true }).state).toBe("unknown");
    expect(resolveProLooksAccess({ ...signedIn, entitlement: entitlement({ lockedReason: "trial_expired" }), entitlementError: "offline" }).state).toBe("unknown");
    const unknown: ProLooksAccess = { state: "unknown" };
    expect(isLookLocked({ kind: "coat", id: "sage" }, { access: unknown, currentIcon: "classic", currentCoat: "ivory", keptCoat: null })).toBe(false);
  });

  it("never locks the look in use, a free look or a coat kept from before coats were locked", () => {
    const access: ProLooksAccess = { state: "upgrade" };
    const input = { access, currentIcon: "peek" as const, currentCoat: "ivory" as const, keptCoat: "apricot" as const };
    expect(isLookLocked({ kind: "icon", id: "peek" }, input)).toBe(false);
    expect(isLookLocked({ kind: "icon", id: "omega" }, input)).toBe(true);
    expect(isLookLocked({ kind: "icon", id: "midnight" }, input)).toBe(false);
    expect(isLookLocked({ kind: "icon", id: "retro" }, input)).toBe(true);
    expect(isLookLocked({ kind: "coat", id: "grey" }, input)).toBe(false);
    expect(isLookLocked({ kind: "coat", id: "apricot" }, input)).toBe(false);
    expect(isLookLocked({ kind: "coat", id: "charcoal" }, input)).toBe(true);
  });

  it("leaves Moss and Charcoal free, locks every other accent and custom colors, and never the accent in use", () => {
    const base = { access: { state: "upgrade" } as ProLooksAccess, currentIcon: "classic" as const, currentCoat: "ivory" as const, keptCoat: null };
    expect(isLookLocked({ kind: "accent", id: "#5f7f31" }, base)).toBe(false);
    expect(isLookLocked({ kind: "accent", id: "#4d4b45" }, base)).toBe(false);
    expect(isLookLocked({ kind: "accent", id: "#9b5b91" }, base)).toBe(true);
    expect(isLookLocked({ kind: "accent", id: "custom" }, base)).toBe(true);
    expect(isLookLocked({ kind: "accent", id: "#9b5b91" }, { ...base, currentAccent: "#9b5b91" })).toBe(false);
    expect(isLookLocked({ kind: "accent", id: "#123456" }, { ...base, keptAccent: "#123456" })).toBe(false);
    expect(isLookLocked({ kind: "accent", id: "custom" }, { ...base, keptAccent: "#123456" })).toBe(true);
    expect(isLookLocked({ kind: "accent", id: "#9b5b91" }, { ...base, access: { state: "unknown" } })).toBe(false);
    expect(isLookLocked({ kind: "accent", id: "custom" }, { ...base, access: { state: "open", trialEndsAt: null, trialing: false } })).toBe(false);
  });
});

describe("accents kept from before the lock", () => {
  beforeEach(() => window.localStorage.clear());

  it("remembers a Pro or custom accent in use on the first launch only", () => {
    expect(resolveKeptAccent("#B9565B")).toBe("#b9565b");
    expect(resolveKeptAccent("#9b5b91")).toBe("#b9565b");
  });

  it("keeps nothing for an unset or free accent", () => {
    expect(resolveKeptAccent(undefined)).toBeNull();
    window.localStorage.clear();
    expect(resolveKeptAccent("#4d4b45")).toBeNull();
    expect(resolveKeptAccent("#9b5b91")).toBeNull();
  });

  it("remembers a put-away accent alongside icons and coats", () => {
    writeRevertedLooks({ accent: "#9B5B91" });
    expect(readRevertedLooks()).toEqual({ accent: "#9b5b91" });
    writeRevertedLooks({ accent: "#5f7f31" });
    expect(readRevertedLooks()).toBeNull();
  });
});

describe("coats kept from before the lock", () => {
  beforeEach(() => window.localStorage.clear());

  it("remembers a Pro coat already in use on the first launch only", () => {
    window.localStorage.setItem(PET_MODE_COAT_STORAGE_KEY, "apricot");
    expect(resolveKeptCoat()).toBe("apricot");
    window.localStorage.setItem(PET_MODE_COAT_STORAGE_KEY, "sage");
    expect(resolveKeptCoat()).toBe("apricot");
  });

  it("keeps nothing for a fresh install or a free coat", () => {
    expect(resolveKeptCoat()).toBeNull();
    window.localStorage.clear();
    window.localStorage.setItem(PET_MODE_COAT_STORAGE_KEY, "grey");
    expect(resolveKeptCoat()).toBeNull();
    window.localStorage.setItem(PET_MODE_COAT_STORAGE_KEY, "plum");
    expect(resolveKeptCoat()).toBeNull();
  });
});

function CoatPicker({ access }: { readonly access: ProLooksAccess }) {
  const [coat, setCoat] = useState<PetModeCoat>(resolveInitialPetModeCoat);
  const looks = useProLooksController({
    access, appIconsSupported: false, coat, setCoat, flowOpen: false,
    requestSignIn: vi.fn(), startTrial: vi.fn(async () => undefined), openProSheet: vi.fn(), openAccountSettings: vi.fn(),
  });
  return (
    <LocalizationTestProvider language="en">
      <ProLooksProvider value={looks}>
        <PetCoatPicker value={coat} onChange={setCoat} />
      </ProLooksProvider>
    </LocalizationTestProvider>
  );
}

describe("pet coat picker", () => {
  beforeEach(() => window.localStorage.clear());
  afterEach(() => cleanup());

  it("leaves Ivory and Grey free, offers five representatives and tries locked skins from More", async () => {
    const view = render(<CoatPicker access={{ state: "upgrade" }} />);
    expect(screen.getAllByRole("radio").map((radio) => radio.getAttribute("aria-label"))).toEqual([
      "Ivory", "Grey", "Honey · Pro", "Mist Blue · Pro", "Plum · Pro",
    ]);
    expect(view.container.querySelectorAll(".pro-look-lock")).toHaveLength(3);
    fireEvent.click(screen.getByRole("button", { name: "More" }));
    const bubble = screen.getByRole("dialog", { name: "Skin" });
    expect(within(bubble).getAllByRole("radio")).toHaveLength(32);

    fireEvent.click(within(bubble).getByRole("radio", { name: "Sage · Pro" }));
    expect(within(bubble).getByText("Trying on")).toBeTruthy();
    expect(window.localStorage.getItem(PET_MODE_COAT_PREVIEW_STORAGE_KEY)).toBe("sage");
    expect(window.localStorage.getItem(PET_MODE_COAT_STORAGE_KEY)).not.toBe("sage");

    fireEvent.click(within(bubble).getByRole("button", { name: "Close" }));
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    expect(window.localStorage.getItem(PET_MODE_COAT_PREVIEW_STORAGE_KEY)).toBeNull();

    fireEvent.click(screen.getByRole("radio", { name: "Grey" }));
    expect(screen.getByRole("radio", { name: "Grey" }).getAttribute("aria-checked")).toBe("true");
  });

  it("lets someone keep the Pro coat they used before coats were locked", async () => {
    window.localStorage.setItem(PET_MODE_COAT_STORAGE_KEY, "apricot");
    render(<CoatPicker access={{ state: "upgrade" }} />);
    expect(screen.getByRole("radio", { name: "Apricot" }).getAttribute("aria-checked")).toBe("true");
    fireEvent.click(screen.getByRole("radio", { name: "Ivory" }));
    fireEvent.click(screen.getByRole("button", { name: "More" }));
    const dialog = within(screen.getByRole("dialog", { name: "Skin" }));
    fireEvent.click(dialog.getByRole("radio", { name: "Apricot" }));
    await waitFor(() => expect(dialog.getByRole("radio", { name: "Apricot" }).getAttribute("aria-checked")).toBe("true"));
    expect(dialog.getByRole("radio", { name: "Sage · Pro" })).toBeTruthy();
  });

  it("puts a Pro coat away when Pro is known to have ended", async () => {
    window.localStorage.setItem("drifty.pet.coatLockStarted", "1");
    window.localStorage.setItem(PET_MODE_COAT_STORAGE_KEY, "sage");
    render(<CoatPicker access={{ state: "upgrade" }} />);
    await waitFor(() => expect(screen.getByRole("radio", { name: "Ivory" }).getAttribute("aria-checked")).toBe("true"));
    expect(screen.getByText("Pro ended, so your pet is back to Ivory. Start Pro and the ‘Sage’ coat comes back.")).toBeTruthy();
  });
});

