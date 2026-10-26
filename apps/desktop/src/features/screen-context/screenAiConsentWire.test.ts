import { expect, it } from "vitest";
import { decodeScreenAiChoices, decodeScreenAiReview, decodeScreenAiSaved, decodeScreenAiSettings, emptyScreenAiChoices } from "./screenAiConsentWire";

const choices = { ...emptyScreenAiChoices(), accessibilityText: true, purposes: ["classification"] };
const recipient = { policyVersion: 1, modelId: "owned-model", modelLabel: "Owned local model", processing: "app_owned_local_runtime", imagesSupported: false };
const id = "01a15472-0000-4000-8000-000000000001";
const status = () => ({ recipient, savedChoices: choices, preferencesInvalid: false, active: false, deliveryAvailable: false, pendingReviewId: null });

it("refuses coerced, duplicate, unknown and half-selected sources or purposes", () => {
  expect(decodeScreenAiChoices(choices)).toEqual(choices);
  for (const patch of [{ accessibilityText: "true" }, { purposes: [] }, { purposes: ["classification", "classification"] }, { purposes: ["training"] }]) {
    expect(() => decodeScreenAiChoices({ ...choices, ...patch })).toThrow("screen_context_invalid_response");
  }
});
it("refuses unavailable or unreadable choices claiming active AI use", () => {
  expect(decodeScreenAiSettings(status()).active).toBe(false);
  for (const patch of [{ active: true }, { recipient: null }, { pendingReviewId: "path-or-model" }, { preferencesInvalid: true }, { pendingReviewId: undefined }]) {
    expect(() => decodeScreenAiSettings({ ...status(), ...patch })).toThrow("screen_context_invalid_response");
  }
  expect(() => decodeScreenAiSettings({ ...status(), recipient: null, savedChoices: null, pendingReviewId: id })).toThrow();
});
it("requires a bounded native review with explicit supported choices", () => {
  const review = { reviewId: id, choices, recipient, expiresAtMs: Date.now() + 60_000 };
  expect(decodeScreenAiReview(review).reviewId).toBe(id);
  for (const patch of [{ expiresAtMs: Date.now() - 1 }, { expiresAtMs: Date.now() + 180_000 }, { choices: { ...choices, images: true } }, { choices: emptyScreenAiChoices() }]) {
    expect(() => decodeScreenAiReview({ ...review, ...patch })).toThrow("screen_context_invalid_response");
  }
});
it("projects only content-free fields and does not infer activation from a save", () => {
  const decoded = decodeScreenAiSettings({ ...status(), path: "PRIVATE_PATH", pixels: "PRIVATE_PIXELS", configuration: "PRIVATE_CONFIGURATION" });
  expect(JSON.stringify(decoded)).not.toMatch(/PRIVATE_/);
  expect(decodeScreenAiSaved({ saved: true, active: false })).toEqual({ saved: true, active: false });
  expect(() => decodeScreenAiSaved({ saved: true })).toThrow();
});
