// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const recordProFunnelStep = vi.fn((_properties: unknown) => Promise.resolve(true));
vi.mock("../../lib/analytics/proFunnel", async (importOriginal) => ({
  ...await importOriginal<typeof import("../../lib/analytics/proFunnel")>(),
  recordProFunnelStep: (properties: unknown) => recordProFunnelStep(properties),
}));

import { TrialEndNotice } from "./TrialEndNotice";

describe("TrialEndNotice", () => {
  beforeEach(() => {
    recordProFunnelStep.mockClear();
    window.matchMedia = vi.fn().mockReturnValue({ matches: true }) as unknown as typeof window.matchMedia;
  });
  afterEach(() => cleanup());

  const renderNotice = (funnelEnabled = true) => {
    const handlers = { onViewPlans: vi.fn(), onDismiss: vi.fn() };
    render(<TrialEndNotice funnelEnabled={funnelEnabled} unclassifiedSeconds={5100} {...handlers} />);
    return handlers;
  };

  it("names today's unclassified time on two lines, in the top-right notice lane", () => {
    renderNotice();
    const notice = screen.getByRole("status", { name: "1h 25m left unclassified today" });
    expect(notice.closest(".floating-notice-stack")).toBeTruthy();
    expect(notice.querySelector(".trial-end-notice__copy span")?.textContent).toMatch(/Pro trial has ended/);
  });

  it("offers one View plans action and a close control, nothing about Local AI or checkout", () => {
    const handlers = renderNotice();
    const notice = screen.getByRole("status");
    expect(within(notice).getAllByRole("button")).toHaveLength(2);
    expect(within(notice).queryByRole("button", { name: /local ai|subscribe|checkout/i })).toBeNull();
    fireEvent.click(within(notice).getByRole("button", { name: "View plans" }));
    expect(handlers.onViewPlans).toHaveBeenCalledTimes(1);
    expect(recordProFunnelStep).toHaveBeenCalledWith({
      step: "pro_offer_acted", offer_surface: "trial_end_notice", offer_context: "trial_ended", offer_action: "view_plans",
    });
  });

  it("records a dismissal and acts at most once", () => {
    const handlers = renderNotice();
    const close = screen.getByRole("button", { name: "Dismiss trial-end notice" });
    fireEvent.click(close);
    fireEvent.click(close);
    fireEvent.click(screen.getByRole("button", { name: "View plans" }));
    expect(handlers.onDismiss).toHaveBeenCalledTimes(1);
    expect(handlers.onViewPlans).not.toHaveBeenCalled();
    expect(recordProFunnelStep).toHaveBeenCalledTimes(1);
    expect(recordProFunnelStep).toHaveBeenCalledWith(expect.objectContaining({ offer_action: "dismiss" }));
  });

  it("uses inactive-plan wording and bounded plan events", () => {
    const onViewPlans = vi.fn();
    render(<TrialEndNotice planInactive funnelEnabled unclassifiedSeconds={5100} onViewPlans={onViewPlans} onDismiss={vi.fn()} />);
    expect(screen.getByText(/Pro is inactive, so new activity/)).toBeTruthy();
    expect(screen.getByRole("button", { name: "Dismiss Pro notice" })).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "View plans" }));
    expect(onViewPlans).toHaveBeenCalledOnce();
    expect(recordProFunnelStep).toHaveBeenCalledWith({
      step: "pro_offer_acted", offer_surface: "plan_end_notice", offer_context: "plan_inactive", offer_action: "view_plans",
    });
  });

  it("sends no funnel event when the funnel is disabled", () => {
    renderNotice(false);
    fireEvent.click(screen.getByRole("button", { name: "View plans" }));
    expect(recordProFunnelStep).not.toHaveBeenCalled();
  });
});
