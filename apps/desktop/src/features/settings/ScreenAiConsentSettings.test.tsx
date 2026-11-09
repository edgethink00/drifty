// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import type { ScreenAiChoices, ScreenAiReview } from "@drifty/domain";
import { ScreenContextClient, type ScreenContextInvoke } from "../screen-context/screenContextClient";
import { decodeScreenAiChoices, emptyScreenAiChoices } from "../screen-context/screenAiConsentWire";
import { ScreenAiConsentSettings } from "./ScreenAiConsentSettings";

const LEASE = "01a15472-0000-4000-8000-000000000001";
const clients: ScreenContextClient[] = [];
afterEach(() => { cleanup(); clients.splice(0).forEach(client => client.dispose()); vi.useRealTimers(); vi.restoreAllMocks(); });
function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>(done => { resolve = done; });
  return { promise, resolve };
}
function fixture() {
  let sequence = 1;
  let pending: ScreenAiReview | null = null;
  let saved: ScreenAiChoices = emptyScreenAiChoices();
  let saveFails = false, offFails = false, unreadable = false, readFails = false, deliveryAvailable = true;
  let modelLabel = "Owned local model";
  let prepareWait: ReturnType<typeof deferred<void>> | null = null;
  let confirmWait: ReturnType<typeof deferred<unknown>> | null = null;
  const recipient = () => ({ policyVersion: 1 as const, modelId: "owned-model", modelLabel,
    processing: "app_owned_local_runtime" as const, imagesSupported: false });
  const reply = (value: unknown) => ({ leaseId: LEASE, value });
  const invoke = vi.fn<ScreenContextInvoke>(async (command, args) => {
    if (command === "screen_context_revoke_account") { pending = null; return; }
    if (command === "screen_context_bind_account") return reply({ mode: "local", expiresAtMs: Date.now() + 15 * 60_000 });
    if (command === "screen_context_was_configured") return false;
    if (command === "screen_context_ai_get_settings") {
      if (readFails) throw "screen_context_unavailable";
      return reply({ recipient: recipient(), savedChoices: unreadable ? null : saved, preferencesInvalid: unreadable,
        active: false, deliveryAvailable, pendingReviewId: pending?.reviewId ?? null });
    }
    if (command === "screen_context_ai_prepare_review") {
      const choices = decodeScreenAiChoices(args?.choices);
      const value: ScreenAiReview = { reviewId: `01a15472-0000-4000-8000-${(++sequence).toString(16).padStart(12, "0")}`,
        choices, recipient: recipient(), expiresAtMs: Date.now() + 120_000 };
      pending = value;
      if (prepareWait) await prepareWait.promise;
      return reply(value);
    }
    if (command === "screen_context_ai_cancel_review") {
      if (pending?.reviewId === args?.reviewId) pending = null;
      return reply(true);
    }
    if (command === "screen_context_ai_confirm_review") {
      const value = pending;
      if (!value || value.reviewId !== args?.reviewId) throw "screen_context_account_changed";
      if (confirmWait) return confirmWait.promise;
      pending = null;
      if (saveFails) throw "screen_context_ai_settings_unsaved";
      saved = value.choices;
      return reply({ saved: true, active: false });
    }
    if (command === "screen_context_ai_turn_off") {
      pending = null;
      if (offFails) throw "screen_context_ai_settings_unsaved";
      saved = emptyScreenAiChoices(); unreadable = false;
      return reply({ saved: true, active: false });
    }
    throw "screen_context_unavailable";
  });
  const client = new ScreenContextClient(invoke, true); clients.push(client); client.setAccount(null);
  return { client, invoke, reply, setSaveFails: () => { saveFails = true; }, setOffFails: () => { offFails = true; },
    setUnreadable: () => { unreadable = true; }, restart: () => { pending = null; }, failReads: () => { readFails = true; },
    changeModel: () => { modelLabel = "Another owned model"; }, holdDelivery: () => { deliveryAvailable = false; },
    deferPrepare: () => (prepareWait = deferred<void>()), deferConfirm: () => (confirmWait = deferred<unknown>()) };
}
async function choose() {
  await screen.findByText("Runs on this computer with Owned local model", { exact: true });
  fireEvent.click(screen.getByRole("checkbox", { name: "Visible text provided by apps" }));
  fireEvent.click(screen.getByRole("checkbox", { name: "Activity classification" }));
}
async function prepare() {
  const opener = screen.getByRole("button", { name: "Review and turn on…" });
  opener.focus();
  fireEvent.click(opener);
  return screen.findByRole("dialog");
}

it("requires independent source and purpose choices and preserves them through Escape", async () => {
  const f = fixture(); render(<ScreenAiConsentSettings client={f.client} expectedModelId="owned-model" />);
  await screen.findByText("Runs on this computer with Owned local model", { exact: true });
  expect(screen.getAllByRole("checkbox").every(input => !(input as HTMLInputElement).checked)).toBe(true);
  const opener = screen.getByRole("button", { name: "Review and turn on…" });
  fireEvent.click(screen.getByRole("checkbox", { name: "Visible text provided by apps" }));
  expect((opener as HTMLButtonElement).disabled).toBe(true);
  fireEvent.click(screen.getByRole("checkbox", { name: "Activity classification" }));
  const dialog = await prepare();
  expect(within(dialog).getByText("Visible text provided by apps", { exact: true })).toBeTruthy();
  fireEvent.keyDown(document, { key: "Escape" });
  await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
  expect((screen.getByRole("checkbox", { name: "Visible text provided by apps" }) as HTMLInputElement).checked).toBe(true);
  expect(document.activeElement).toBe(opener);
  expect(f.invoke.mock.calls.some(([command]) => command === "screen_context_ai_confirm_review")).toBe(false);
});

it("returns after explicit confirmation and discards a late save acknowledgment after OFF", async () => {
  const f = fixture(), saving = f.deferConfirm(); render(<ScreenAiConsentSettings client={f.client} expectedModelId="owned-model" />);
  await choose(); const dialog = await prepare();
  fireEvent.click(within(dialog).getByRole("button", { name: "Save these choices" }));
  await screen.findByText("Saving choices…", { exact: true });
  fireEvent.click(screen.getByRole("button", { name: "Turn off" }));
  await screen.findByText("Your choices were saved.", { exact: true });
  await act(async () => { saving.resolve(f.reply({ saved: true, active: true })); });
  expect((screen.getByRole("checkbox", { name: "Visible text provided by apps" }) as HTMLInputElement).checked).toBe(false);
  expect(screen.getByText("AI use off", { exact: true })).toBeTruthy();
  expect(screen.queryByText("AI use allowed", { exact: true })).toBeNull();
  expect(f.invoke.mock.calls.filter(([command]) => command === "screen_context_ai_turn_off")).toHaveLength(1);
});

it("closes a pending review when the native process changes without changing its label", async () => {
  const f = fixture(); render(<ScreenAiConsentSettings client={f.client} expectedModelId="owned-model" />);
  await choose(); await prepare(); f.restart();
  await screen.findByText("The recipient or confirmation time changed. Review your choices again.", {}, { timeout: 5000 });
  await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
  expect(screen.getByText("Runs on this computer with Owned local model", { exact: true })).toBeTruthy();
  expect(f.invoke.mock.calls.some(([command]) => command === "screen_context_ai_confirm_review")).toBe(false);
});

it("cancels a late prepared native review after the page unmounts", async () => {
  const f = fixture(), waiting = f.deferPrepare(); const view = render(<ScreenAiConsentSettings client={f.client} expectedModelId="owned-model" />);
  await choose(); fireEvent.click(screen.getByRole("button", { name: "Review and turn on…" }));
  await waitFor(() => expect(f.invoke.mock.calls.some(([command]) => command === "screen_context_ai_prepare_review")).toBe(true));
  view.unmount(); await act(async () => { waiting.resolve(); });
  await waitFor(() => expect(f.invoke.mock.calls.filter(([command]) => command === "screen_context_ai_cancel_review")).toHaveLength(1));
  expect(f.invoke.mock.calls.some(([command]) => command === "screen_context_ai_confirm_review")).toBe(false);
});

it("keeps an unsaved OFF across polling and a recipient change", async () => {
  const f = fixture(); render(<ScreenAiConsentSettings client={f.client} expectedModelId="owned-model" />);
  await choose(); const dialog = await prepare();
  fireEvent.click(within(dialog).getByRole("button", { name: "Save these choices" }));
  await screen.findByText("Your choices were saved.", { exact: true });
  f.setOffFails(); fireEvent.click(screen.getByRole("button", { name: "Turn off" }));
  const message = "AI use is off, but the change could not be saved. Try turning it off again.";
  await screen.findByText(message, { exact: true }); f.changeModel();
  await screen.findByText("Runs on this computer with Another owned model", { exact: true }, { timeout: 5000 });
  expect((screen.getByRole("checkbox", { name: "Visible text provided by apps" }) as HTMLInputElement).checked).toBe(false);
  expect(screen.getByText(message, { exact: true })).toBeTruthy();
});

it("keeps failed choices as a draft and requires a fresh native review", async () => {
  const f = fixture(); f.setSaveFails(); render(<ScreenAiConsentSettings client={f.client} expectedModelId="owned-model" />);
  await choose(); const dialog = await prepare();
  fireEvent.click(within(dialog).getByRole("button", { name: "Save these choices" }));
  await screen.findByText("Your choices could not be saved. Review them again to retry.", { exact: true });
  await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
  expect((screen.getByRole("checkbox", { name: "Visible text provided by apps" }) as HTMLInputElement).checked).toBe(true);
  const fresh = await prepare();
  fireEvent.click(within(fresh).getByRole("button", { name: "Save these choices" }));
  await waitFor(() => expect(f.invoke.mock.calls.filter(([command]) => command === "screen_context_ai_confirm_review")).toHaveLength(2));
  const ids = f.invoke.mock.calls.filter(([command]) => command === "screen_context_ai_confirm_review").map(([,args]) => args?.reviewId);
  const prepared = f.invoke.mock.calls.filter(([command]) => command === "screen_context_ai_prepare_review");
  expect(prepared).toHaveLength(2); expect(ids[0]).not.toBe(ids[1]);
});

it("does not allow a new confirmation with unreadable stored choices", async () => {
  const f = fixture(); f.setUnreadable(); render(<ScreenAiConsentSettings client={f.client} expectedModelId="owned-model" />);
  await choose(); expect((screen.getByRole("button", { name: "Review and turn on…" }) as HTMLButtonElement).disabled).toBe(true);
  expect(screen.getByRole("button", { name: "Turn off" })).toBeTruthy();
  expect(f.invoke.mock.calls.some(([command]) => command === "screen_context_ai_prepare_review")).toBe(false);
});

it("closes a pending confirmation when its native status cannot be checked", async () => {
  const f = fixture(); render(<ScreenAiConsentSettings client={f.client} expectedModelId="owned-model" />);
  await choose(); await prepare(); f.failReads();
  await screen.findByText("Current settings could not be checked. Try again.", {}, { timeout: 5000 });
  await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
  expect(f.invoke.mock.calls.some(([command]) => command === "screen_context_ai_cancel_review")).toBe(true);
});

it("offers no screen AI choices while delivery is not available", async () => {
  const f = fixture(); f.holdDelivery();
  render(<ScreenAiConsentSettings client={f.client} expectedModelId="owned-model" />);
  await waitFor(() => expect(f.invoke.mock.calls.some(([command]) => command === "screen_context_ai_get_settings")).toBe(true));
  await act(async () => { await Promise.resolve(); });
  expect(screen.queryByRole("checkbox")).toBeNull();
  expect(screen.queryByRole("button", { name: "Review and turn on…" })).toBeNull();
  expect(f.invoke.mock.calls.some(([command]) => command === "screen_context_ai_prepare_review")).toBe(false);
});

it("refuses a ready native model that is different from the selected local model", async () => {
  const f = fixture(); render(<ScreenAiConsentSettings client={f.client} expectedModelId="different-model" />);
  await waitFor(() => expect(f.invoke.mock.calls.some(([command]) => command === "screen_context_ai_get_settings")).toBe(true));
  await act(async () => { await Promise.resolve(); });
  // Another model's settings are treated as unavailable, so no choice is offered at all.
  expect(screen.queryByRole("button", { name: "Review and turn on…" })).toBeNull();
  expect(screen.queryByText(/Owned local model/)).toBeNull();
  expect(f.invoke.mock.calls.some(([command]) => command === "screen_context_ai_prepare_review")).toBe(false);
});

it("cancels the native review when the selected AI connection changes", async () => {
  const f = fixture(); const view = render(<ScreenAiConsentSettings client={f.client} expectedModelId="owned-model" />);
  await choose(); await prepare();
  view.rerender(<ScreenAiConsentSettings client={f.client} expectedModelId="different-model" />);
  await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
  await waitFor(() => expect(f.invoke.mock.calls.some(([command]) => command === "screen_context_ai_cancel_review")).toBe(true));
  expect(f.invoke.mock.calls.some(([command]) => command === "screen_context_ai_confirm_review")).toBe(false);
  expect(screen.queryByRole("checkbox", { name: "Visible text provided by apps" })).toBeNull();
});


it("pauses screen AI status reads while hidden and refreshes on return", async () => {
  vi.useFakeTimers();
  let visibility: DocumentVisibilityState = "visible";
  vi.spyOn(document, "visibilityState", "get").mockImplementation(() => visibility);
  const f = fixture();
  const reads = () => f.invoke.mock.calls.filter(([command]) => command === "screen_context_ai_get_settings").length;
  const view = render(<ScreenAiConsentSettings client={f.client} expectedModelId="owned-model" />);
  await act(async () => { await vi.advanceTimersByTimeAsync(0); });
  expect(screen.getByText("Runs on this computer with Owned local model", { exact: true })).toBeTruthy();
  const visibleReads = reads();
  await act(async () => { await vi.advanceTimersByTimeAsync(2_000); });
  expect(reads()).toBeGreaterThan(visibleReads);
  act(() => { visibility = "hidden"; document.dispatchEvent(new Event("visibilitychange")); });
  const beforeHidden = reads();
  f.changeModel();
  await act(async () => { await vi.advanceTimersByTimeAsync(10_000); });
  expect(reads()).toBe(beforeHidden);
  await act(async () => { visibility = "visible"; document.dispatchEvent(new Event("visibilitychange")); });
  expect(reads()).toBe(beforeHidden + 1);
  expect(screen.getByText("Runs on this computer with Another owned model", { exact: true })).toBeTruthy();
  view.unmount();
  const afterUnmount = reads();
  await act(async () => { document.dispatchEvent(new Event("visibilitychange")); await vi.advanceTimersByTimeAsync(4_000); });
  expect(reads()).toBe(afterUnmount);
});

it("does not start screen AI status reads when mounted hidden", async () => {
  vi.useFakeTimers();
  let visibility: DocumentVisibilityState = "hidden";
  vi.spyOn(document, "visibilityState", "get").mockImplementation(() => visibility);
  const f = fixture();
  render(<ScreenAiConsentSettings client={f.client} expectedModelId="owned-model" />);
  await act(async () => { await vi.advanceTimersByTimeAsync(6_000); });
  expect(f.invoke.mock.calls.some(([command]) => command === "screen_context_ai_get_settings")).toBe(false);
  await act(async () => { visibility = "visible"; document.dispatchEvent(new Event("visibilitychange")); });
  expect(screen.getByText("Runs on this computer with Owned local model", { exact: true })).toBeTruthy();
  expect(f.invoke.mock.calls.some(([command]) => command === "screen_context_ai_prepare_review" || command === "screen_context_ai_confirm_review")).toBe(false);
});


it("still expires a pending native review while status polling is hidden", async () => {
  vi.useFakeTimers();
  let visibility: DocumentVisibilityState = "visible";
  vi.spyOn(document, "visibilityState", "get").mockImplementation(() => visibility);
  const f = fixture();
  render(<ScreenAiConsentSettings client={f.client} expectedModelId="owned-model" />);
  await act(async () => { await vi.advanceTimersByTimeAsync(0); });
  fireEvent.click(screen.getByRole("checkbox", { name: "Visible text provided by apps" }));
  fireEvent.click(screen.getByRole("checkbox", { name: "Activity classification" }));
  await act(async () => { fireEvent.click(screen.getByRole("button", { name: "Review and turn on…" })); });
  expect(screen.getByRole("dialog")).toBeTruthy();
  act(() => { visibility = "hidden"; document.dispatchEvent(new Event("visibilitychange")); });
  const reads = f.invoke.mock.calls.filter(([command]) => command === "screen_context_ai_get_settings").length;
  await act(async () => { await vi.advanceTimersByTimeAsync(120_001); });
  expect(f.invoke.mock.calls.some(([command]) => command === "screen_context_ai_cancel_review")).toBe(true);
  // Business cancellation precedes the modal's retained exit animation.
  await act(async () => { await vi.advanceTimersByTimeAsync(250); });
  expect(screen.queryByRole("dialog")).toBeNull();
  expect(f.invoke.mock.calls.filter(([command]) => command === "screen_context_ai_get_settings")).toHaveLength(reads);
  expect(f.invoke.mock.calls.some(([command]) => command === "screen_context_ai_cancel_review")).toBe(true);
  expect(f.invoke.mock.calls.some(([command]) => command === "screen_context_ai_confirm_review")).toBe(false);
  await act(async () => { visibility = "visible"; document.dispatchEvent(new Event("visibilitychange")); });
  expect(screen.getByText("The recipient or confirmation time changed. Review your choices again.", { exact: true })).toBeTruthy();
});
