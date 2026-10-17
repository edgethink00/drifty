// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";


import { ProDecisionSheet } from "./ProDecisionSheet";
import { STANDARD_INDIVIDUAL_PRICING_QUOTE } from "./individualPricing";

describe("ProDecisionSheet", () => {
  beforeEach(() => {
    window.matchMedia = vi.fn().mockReturnValue({ matches: true, addEventListener: vi.fn(), removeEventListener: vi.fn() }) as unknown as typeof window.matchMedia;
  });
  afterEach(() => {
    cleanup();
    vi.useRealTimers();
  });

  const renderSheet = (overrides: Partial<Parameters<typeof ProDecisionSheet>[0]> = {}) => {
    const handlers = { onSelectBillingPlan: vi.fn(), onDismiss: vi.fn(), onCheckForUpdates: vi.fn() };
    const view = render(<ProDecisionSheet
      open context="trial-ended" funnelEnabled trialEndsAt="2026-10-08T06:30:00.000Z" unclassifiedSeconds={7800}
      billingCheckoutLoadingInterval={null} {...handlers} {...overrides}
    />);
    return { ...handlers, rerender: (next: Partial<Parameters<typeof ProDecisionSheet>[0]>) => view.rerender(<ProDecisionSheet
      open context="trial-ended" funnelEnabled trialEndsAt="2026-10-08T06:30:00.000Z" unclassifiedSeconds={7800}
      billingCheckoutLoadingInterval={null} {...handlers} {...overrides} {...next}
    />) };
  };

  it("shows the two cadences as one choice, monthly first, with the user's unclassified time as the reason", () => {
    const handlers = renderSheet();
    const dialog = screen.getByRole("dialog", { name: "Your Pro trial has ended" });
    expect(within(dialog).getByText(/2h 10m has been left unclassified today/)).toBeTruthy();
    const group = within(dialog).getByRole("radiogroup", { name: "Billing interval" });
    const [monthly, yearly] = within(group).getAllByRole("radio");
    expect(within(monthly).getByText("$7")).toBeTruthy();
    expect(within(monthly).getByText("Billed monthly.")).toBeTruthy();
    expect(within(yearly).getByText("$5")).toBeTruthy();
    expect(within(yearly).getByText("Save 28%")).toBeTruthy();
    expect(within(yearly).getByText("$60 billed yearly. Saves $24 a year.")).toBeTruthy();
    expect(monthly.getAttribute("aria-checked")).toBe("true");
    expect(within(dialog).getByText("Everything in Free, plus")).toBeTruthy();
    const value = within(dialog).getByRole("list", { name: "Included with Pro" });
    expect(within(value).getAllByRole("listitem").map((item) => item.textContent)).toEqual([
      "Cloud AI classification · Claude 5.5", "Project analysis · GPT-6", "Activity sync across 3 computers", "No downloads or API keys",
      "4 pet coats and every accent color",
    ]);
    expect(within(dialog).getByText("Cancel anytime.")).toBeTruthy();
    expect(within(dialog).queryByRole("button", { name: /local ai/i })).toBeNull();

    fireEvent.click(within(dialog).getByRole("button", { name: "Start monthly" }));
    expect(handlers.onSelectBillingPlan).toHaveBeenLastCalledWith("monthly");
    fireEvent.click(yearly);
    expect(yearly.getAttribute("aria-checked")).toBe("true");
    fireEvent.click(within(dialog).getByRole("button", { name: "Start yearly" }));
    expect(handlers.onSelectBillingPlan).toHaveBeenLastCalledWith("yearly");
  });

  it("titles the sheet for the account state it is shown for", () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date("2026-10-10T12:00:00.000Z"));
    renderSheet({ context: "trial-active", trialEndsAt: "2026-10-12T09:00:00.000Z", unclassifiedSeconds: null });
    expect(screen.getByRole("dialog", { name: "2 days left in your Pro trial" })).toBeTruthy();
    // Checkout during the trial bills today (no Polar trial), so the sheet says so.
    expect(screen.getByText("Billing starts today, and Cloud AI classification carries on after the trial ends.")).toBeTruthy();
    cleanup();
    renderSheet({ context: "trial-active", trialEndsAt: "2026-10-10T20:00:00.000Z", unclassifiedSeconds: null });
    expect(screen.getByRole("dialog", { name: "1 day left in your Pro trial" })).toBeTruthy();
    cleanup();
    renderSheet({ context: "upgrade", trialEndsAt: null, unclassifiedSeconds: null });
    expect(screen.getByRole("dialog", { name: "Upgrade to Pro" })).toBeTruthy();
    expect(screen.getByText("Cloud AI classifies your activity, with no model to set up.")).toBeTruthy();
    cleanup();
    renderSheet({ context: "upgrade-local", trialEndsAt: null, unclassifiedSeconds: null });
    expect(screen.getByText("Once you pay, classification switches to Cloud AI. Your Local AI setup stays.")).toBeTruthy();
    cleanup();
    renderSheet({ unclassifiedSeconds: 0 });
    expect(screen.getByText(/Everything recorded so far stays\. Start Pro/)).toBeTruthy();
  });

  it("names the end time only when the trial ended today", () => {
    renderSheet({ trialEndedToday: true });
    expect(screen.getByText(/^Since .+, 2h 10m has been left unclassified\./)).toBeTruthy();
    cleanup();
    // Days later, today's unclassified total did not start at the old end time.
    renderSheet({ trialEndedToday: false });
    expect(screen.getByText("2h 10m has been left unclassified today. Start Pro and it is classified right away.")).toBeTruthy();
    expect(screen.queryByText(/^Since /)).toBeNull();
  });

  it("closes from Not now and from the close button", () => {
    const later = renderSheet();
    fireEvent.click(screen.getByRole("button", { name: "Not now" }));
    expect(later.onDismiss).toHaveBeenCalledTimes(1);
    cleanup();
    const upgrade = renderSheet({ context: "upgrade-local" });
    fireEvent.click(screen.getByRole("button", { name: "Close plan choice" }));
    expect(upgrade.onDismiss).toHaveBeenCalledTimes(1);
  });

  it("shows a checkout failure after the action, with Check for updates when the price changed", () => {
    const sheet = renderSheet();
    expect(screen.queryByRole("alert")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Start monthly" }));
    sheet.rerender({ billingActionError: "Checkout could not open.", billingActionErrorCode: "pricing_revision_mismatch" });
    const alert = screen.getByRole("alert");
    expect(within(alert).getByText("Checkout could not open.")).toBeTruthy();
    fireEvent.click(within(alert).getByRole("button", { name: "Check for updates" }));
    expect(sheet.onCheckForUpdates).toHaveBeenCalledTimes(1);
  });

  it("names a regional price under the cards", () => {
    renderSheet({ individualPricingQuote: { ...STANDARD_INDIVIDUAL_PRICING_QUOTE, variant: "regional" } });
    expect(screen.getByText(`Regional price · charged in ${STANDARD_INDIVIDUAL_PRICING_QUOTE.currency}`)).toBeTruthy();
    cleanup();
    renderSheet();
    expect(screen.queryByText(/Regional price/)).toBeNull();
  });

  it("moves the selection with arrow keys and locks the choice while checkout opens", () => {
    renderSheet();
    const [monthly, yearly] = screen.getAllByRole("radio");
    fireEvent.keyDown(monthly, { key: "ArrowRight" });
    expect(yearly.getAttribute("aria-checked")).toBe("true");
    expect(yearly.tabIndex).toBe(0);
    expect(monthly.tabIndex).toBe(-1);
    fireEvent.keyDown(yearly, { key: "ArrowLeft" });
    expect(monthly.getAttribute("aria-checked")).toBe("true");
    cleanup();
    renderSheet({ billingCheckoutLoadingInterval: "monthly" });
    expect(screen.getByRole("button", { name: "Opening checkout…" }).hasAttribute("disabled")).toBe(true);
    expect(screen.getAllByRole("radio").every((radio) => radio.hasAttribute("disabled"))).toBe(true);
    expect(screen.getByRole("button", { name: "Not now" }).hasAttribute("disabled")).toBe(true);
  });

  it("cannot be dismissed while checkout opens, so Privacy settings stay out of reach", () => {
    // The pending-checkout opt-out race needs Settings > Privacy, which this
    // sheet covers. docs/analytics/pro-funnel.md relies on this lock to record
    // that race as not reachable; a dismissal path here reopens the live check.
    const opening = renderSheet({ billingCheckoutLoadingInterval: "monthly" });
    fireEvent.keyDown(window, { key: "Escape" });
    const closeButton = screen.getByRole("button", { name: "Close plan choice" });
    expect(closeButton.hasAttribute("disabled")).toBe(true);
    fireEvent.click(closeButton);
    const overlay = document.querySelector(".pro-sheet") as HTMLElement;
    fireEvent.pointerDown(overlay);
    fireEvent.click(overlay);
    expect(opening.onDismiss).not.toHaveBeenCalled();

    cleanup();
    const idle = renderSheet();
    fireEvent.keyDown(window, { key: "Escape" });
    expect(idle.onDismiss).toHaveBeenCalledTimes(1);
  });


  it("renders nothing when closed", () => {
    renderSheet({ open: false });
    expect(screen.queryByRole("dialog")).toBeNull();
  });
});


describe("ProDecisionSheet opened from a locked Pro look", () => {
  beforeEach(() => {
    window.matchMedia = vi.fn().mockReturnValue({ matches: true, addEventListener: vi.fn(), removeEventListener: vi.fn() }) as unknown as typeof window.matchMedia;
  });
  afterEach(() => cleanup());

  it("names the look beside its picture, keeps the plans, and lists every app icon and accent color on macOS", () => {
    render(<ProDecisionSheet
      open context="trial-ended" funnelEnabled trialEndsAt="2026-10-08T06:30:00.000Z" unclassifiedSeconds={7800}
      billingCheckoutLoadingInterval={null} onSelectBillingPlan={vi.fn()} onDismiss={vi.fn()}
      look={{ kind: "icon", id: "peek" }} looksIncludeAppIcons
    />);
    const dialog = screen.getByRole("dialog", { name: "‘Peek’ is a Pro icon" });
    expect(within(dialog).getByText("Start Pro and it goes straight into your Dock. Cloud AI classification comes with it.")).toBeTruthy();
    expect(within(dialog).queryByText(/left unclassified/)).toBeNull();
    expect(dialog.querySelector(".pro-look-thumb img")).toBeTruthy();
    expect(within(dialog).getAllByRole("radio")).toHaveLength(2);
    const value = within(dialog).getByRole("list", { name: "Included with Pro" });
    const lines = within(value).getAllByRole("listitem");
    expect(lines[lines.length - 1].textContent).toBe("4 pet coats, every app icon and accent color");
  });

  it("shows a coat on the desktop cat it would dress", () => {
    render(<ProDecisionSheet
      open context="upgrade" funnelEnabled trialEndsAt={null} unclassifiedSeconds={null}
      billingCheckoutLoadingInterval={null} onSelectBillingPlan={vi.fn()} onDismiss={vi.fn()}
      look={{ kind: "coat", id: "sage" }}
    />);
    const dialog = screen.getByRole("dialog", { name: "‘Sage’ is a Pro coat" });
    expect(within(dialog).getByText("Start Pro and your desktop cat wears it right away. Cloud AI classification comes with it.")).toBeTruthy();
    expect(dialog.querySelector(".pro-look-thumb--coat")).toBeTruthy();
  });

  it("shows an accent on a small app window painted in it, and its own colors as Pro", () => {
    const view = render(<ProDecisionSheet
      open context="upgrade" funnelEnabled trialEndsAt={null} unclassifiedSeconds={null}
      billingCheckoutLoadingInterval={null} onSelectBillingPlan={vi.fn()} onDismiss={vi.fn()}
      look={{ kind: "accent", id: "#9b5b91" }}
    />);
    const dialog = screen.getByRole("dialog", { name: "‘Plum’ is a Pro accent color" });
    expect(within(dialog).getByText("Start Pro and the whole app takes this color right away. Cloud AI classification comes with it.")).toBeTruthy();
    const thumb = dialog.querySelector<HTMLElement>(".pro-look-thumb--accent");
    expect(thumb?.style.getPropertyValue("--look-accent")).toBe("#9b5b91");
    view.unmount();

    render(<ProDecisionSheet
      open context="upgrade" funnelEnabled trialEndsAt={null} unclassifiedSeconds={null}
      billingCheckoutLoadingInterval={null} onSelectBillingPlan={vi.fn()} onDismiss={vi.fn()}
      look={{ kind: "accent", id: "custom" }}
    />);
    expect(screen.getByRole("dialog", { name: "Your own accent colors are Pro" }).querySelector(".pro-look-thumb--accent.is-custom")).toBeTruthy();
  });
});

