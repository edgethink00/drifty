import type { ScreenAiPurpose, ScreenAiChoices, ScreenAiRecipient, ScreenAiSettings, ScreenAiReview } from "@drifty/domain";
export type { ScreenAiPurpose, ScreenAiChoices, ScreenAiRecipient, ScreenAiSettings, ScreenAiReview } from "@drifty/domain";
const INVALID = "screen_context_invalid_response";
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const PURPOSES: ScreenAiPurpose[] = ["classification", "project_assignment", "timeline_cards"];
function object(v: unknown): Record<string, unknown> { if (!v || typeof v !== "object" || Array.isArray(v))
    throw new Error(INVALID); return v as Record<string, unknown>; }
function bool(v: unknown): boolean { if (typeof v !== "boolean")
    throw new Error(INVALID); return v; }
function text(v: unknown, max: number): string { if (typeof v !== "string" || !v || v.length > max)
    throw new Error(INVALID); return v; }
function id(v: unknown): string { const s = text(v, 36); if (!UUID.test(s))
    throw new Error(INVALID); return s; }
export function emptyScreenAiChoices(): ScreenAiChoices { return { accessibilityText: false, ocrText: false, images: false, purposes: [] }; }
export function hasScreenAiChoices(v: ScreenAiChoices): boolean { return (v.accessibilityText || v.ocrText || v.images) && v.purposes.length > 0; }
export function sameScreenAiChoices(a: ScreenAiChoices, b: ScreenAiChoices): boolean { return a.accessibilityText === b.accessibilityText && a.ocrText === b.ocrText && a.images === b.images && [...a.purposes].sort().join() === [...b.purposes].sort().join(); }
export function screenAiRecipientKey(v: ScreenAiRecipient | null): string { return v ? JSON.stringify([v.policyVersion, v.modelId, v.modelLabel, v.processing, v.imagesSupported]) : "none"; }
export function decodeScreenAiChoices(raw: unknown): ScreenAiChoices {
    const v = object(raw);
    if (!Array.isArray(v.purposes) || v.purposes.length > 3 || v.purposes.some(p => !PURPOSES.includes(p)) || new Set(v.purposes).size !== v.purposes.length)
        throw new Error(INVALID);
    const result = { accessibilityText: bool(v.accessibilityText), ocrText: bool(v.ocrText), images: bool(v.images), purposes: v.purposes as ScreenAiPurpose[] };
    if ((result.accessibilityText || result.ocrText || result.images) !== (result.purposes.length > 0))
        throw new Error(INVALID);
    return result;
}
function recipient(raw: unknown): ScreenAiRecipient { const v = object(raw); if (v.policyVersion !== 1 || v.processing !== "app_owned_local_runtime")
    throw new Error(INVALID); return { policyVersion: 1, modelId: text(v.modelId, 128), modelLabel: text(v.modelLabel, 128), processing: v.processing, imagesSupported: bool(v.imagesSupported) }; }
export function decodeScreenAiSettings(raw: unknown): ScreenAiSettings {
    const value = object(raw);
    const target = value.recipient === null ? null : recipient(value.recipient);
    const saved = value.savedChoices === null ? null : decodeScreenAiChoices(value.savedChoices);
    const preferencesInvalid = bool(value.preferencesInvalid);
    const active = bool(value.active);
    const deliveryAvailable = bool(value.deliveryAvailable);
    const pendingReviewId = value.pendingReviewId === null ? null : id(value.pendingReviewId);
    if ((!target && (saved || pendingReviewId)) || (saved?.images && !target?.imagesSupported)
        || (preferencesInvalid && saved) || (active && (!deliveryAvailable || !target || !saved || !hasScreenAiChoices(saved) || preferencesInvalid))) {
        throw new Error(INVALID);
    }
    return { recipient: target, savedChoices: saved, preferencesInvalid, active, deliveryAvailable, pendingReviewId };
}
export function decodeScreenAiReview(raw: unknown): ScreenAiReview {
    const v = object(raw), choices = decodeScreenAiChoices(v.choices), target = recipient(v.recipient);
    if (!hasScreenAiChoices(choices) || (choices.images && !target.imagesSupported) || typeof v.expiresAtMs !== "number" || !Number.isSafeInteger(v.expiresAtMs) || v.expiresAtMs <= Date.now() || v.expiresAtMs > Date.now() + 121000)
        throw new Error(INVALID);
    return { reviewId: id(v.reviewId), choices, recipient: target, expiresAtMs: v.expiresAtMs };
}
export function decodeScreenAiSaved(raw: unknown): {
    saved: true;
    active: boolean;
} { const v = object(raw); if (v.saved !== true)
    throw new Error(INVALID); return { saved: true, active: bool(v.active) }; }
export function decodeScreenAiCancelled(raw: unknown): true { if (raw !== true)
    throw new Error(INVALID); return true; }
