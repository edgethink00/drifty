import { useCallback, useEffect, useLayoutEffect, useRef, useState, useSyncExternalStore } from "react";
import { createPortal } from "react-dom";
import { ModalPresence } from "../../components/ModalPresence";
import { KeyHint } from "../../components/KeyHint";
import { useOverlayDismiss } from "../../lib/useOverlayDismiss";
import type { ScreenContextClient } from "../screen-context/screenContextClient";
import { decodeScreenAiCancelled, decodeScreenAiReview, decodeScreenAiSaved, decodeScreenAiSettings, emptyScreenAiChoices, hasScreenAiChoices, sameScreenAiChoices, screenAiRecipientKey, type ScreenAiChoices, type ScreenAiPurpose, type ScreenAiReview, type ScreenAiSettings } from "../screen-context/screenAiConsentWire";
import "../screen-context/screen-ai-consent.css";
import { useLocalization } from "../localization/LocalizationContext";
import { screenAiCopy, type ScreenAiCopy } from "./screenAiCopy";
type Bound<T> = {
    value: T;
    generation: number;
};
// The renderer's connection selection can only restrict this display. It is not
// native recipient authority and cannot grant a send capability.
function selectedSettings(value: ScreenAiSettings, expectedModelId: string): ScreenAiSettings {
    return value.recipient?.modelId === expectedModelId ? value : { ...value, recipient: null, savedChoices: null, pendingReviewId: null, active: false, deliveryAvailable: false };
}
export function ScreenAiConsentSettings({ client, expectedModelId, onOpenAiSettings }: {
    client: ScreenContextClient;
    expectedModelId: string;
    onOpenAiSettings?: () => void;
}) {
    const { t } = useLocalization();
    const copy = screenAiCopy(t);
    const snapshot = useSyncExternalStore(client.subscribe, client.getSnapshot);
    const [status, setStatus] = useState<Bound<ScreenAiSettings> | null>(null), [draft, setDraft] = useState<ScreenAiChoices>(emptyScreenAiChoices), [review, setReview] = useState<Bound<ScreenAiReview> | null>(null);
    const [busy, setBusy] = useState<"prepare" | "save" | "off" | null>(null), [message, setMessage] = useState<keyof ScreenAiCopy | null>(null), [unsavedOff, setUnsavedOff] = useState(false);
    const sequence = useRef(0), statusSequence = useRef(0), alive = useRef(true), hydrated = useRef<string | null>(null), reviewRef = useRef<Bound<ScreenAiReview> | null>(null), busyRef = useRef(busy), unsavedOffRef = useRef(false), opener = useRef<HTMLButtonElement>(null);
    const changeBusy = useCallback((value: typeof busy) => { busyRef.current = value; setBusy(value); }, []);
    const markUnsavedOff = useCallback((value: boolean) => { unsavedOffRef.current = value; setUnsavedOff(value); }, []);
    const invalidateRequests = useCallback(() => {
        ++statusSequence.current;
        return ++sequence.current;
    }, []);
    const invalidateStatusReplies = useCallback(() => { ++statusSequence.current; }, []);
    const current = status && client.canDisplay(status.generation) ? selectedSettings(status.value, expectedModelId) : null;
    const visibleReview = review && client.canDisplay(review.generation) && review.value.recipient.modelId === expectedModelId ? review.value : null;
    const target = current?.recipient ?? null;
    const updateReview = useCallback((value: Bound<ScreenAiReview> | null) => {
        reviewRef.current = value;
        setReview(value);
    }, []);
    const returnFocus = useCallback(() => {
        if (opener.current?.isConnected) opener.current.focus();
    }, []);
    const cancel = useCallback(() => {
        const pending = reviewRef.current;
        invalidateRequests();
        updateReview(null);
        setMessage(null);
        returnFocus();
        if (pending && client.canDisplay(pending.generation)) {
            void client.consume("screen_context_ai_cancel_review", { reviewId: pending.value.reviewId }, decodeScreenAiCancelled, () => {}).catch(() => {});
        }
    }, [client, invalidateRequests, returnFocus, updateReview]);
    const refresh = useCallback(async () => {
        const token = ++statusSequence.current;
        try {
            await client.consume("screen_context_ai_get_settings", {}, decodeScreenAiSettings, (nativeValue, generation) => {
                if (!alive.current || token !== statusSequence.current)
                    return;
                const value = selectedSettings(nativeValue, expectedModelId);
                setStatus({ value, generation });
                const owner = `${generation}:${screenAiRecipientKey(value.recipient)}`;
                if (hydrated.current !== owner) {
                    hydrated.current = owner;
                    setDraft(unsavedOffRef.current ? emptyScreenAiChoices() : value.savedChoices ?? emptyScreenAiChoices());
                }
                const pending = reviewRef.current;
                if (pending && (pending.value.reviewId !== value.pendingReviewId || value.preferencesInvalid)) {
                    cancel();
                    setMessage(value.preferencesInvalid ? "invalidPreferences" : "reviewExpired");
                }
            });
        }
        catch (error) {
            if (alive.current && token === statusSequence.current && !(error instanceof Error && error.message === "screen_context_account_changed")) {
                if (reviewRef.current) cancel();
                setMessage("loadFailed");
            }
        }
    }, [cancel, client, expectedModelId]);
    const dismiss = useOverlayDismiss(cancel);
    useLayoutEffect(() => {
        const pending = reviewRef.current;
        invalidateRequests();
        if (pending && client.canDisplay(pending.generation))
            void client.consume("screen_context_ai_cancel_review", { reviewId: pending.value.reviewId }, decodeScreenAiCancelled, () => {}).catch(() => {});
        hydrated.current = null; updateReview(null); setStatus(null); setDraft(emptyScreenAiChoices()); changeBusy(null); setMessage(null); markUnsavedOff(false);
    }, [changeBusy, client, expectedModelId, invalidateRequests, markUnsavedOff, snapshot.generation, updateReview]);
    useEffect(() => { alive.current = true; return () => { alive.current = false; invalidateRequests(); const pending = reviewRef.current; if (pending && client.canDisplay(pending.generation))
        void client.consume("screen_context_ai_cancel_review", { reviewId: pending.value.reviewId }, decodeScreenAiCancelled, () => { }).catch(() => { }); }; }, [client, invalidateRequests]);
    useEffect(() => {
        if (!client.isDesktop()) return;
        let timer: ReturnType<typeof setInterval> | undefined;
        const poll = () => { if (!busyRef.current) void refresh(); };
        const syncVisibility = () => {
            clearInterval(timer);
            timer = undefined;
            invalidateStatusReplies();
            // Reading status observes the native recipient and existing consent.
            // A hidden settings window does not need that repeated work; actual
            // AI use and confirmation retain their independent native checks.
            if (document.visibilityState === "hidden") return;
            poll();
            timer = setInterval(poll, 2000);
        };
        syncVisibility();
        document.addEventListener("visibilitychange", syncVisibility);
        return () => {
            invalidateStatusReplies();
            clearInterval(timer);
            document.removeEventListener("visibilitychange", syncVisibility);
        };
    }, [client, invalidateStatusReplies, snapshot.generation, refresh]);
    const reviewId = visibleReview?.reviewId;
    const reviewExpiresAtMs = visibleReview?.expiresAtMs;
    useEffect(() => {
        if (!reviewId || !reviewExpiresAtMs) return;
        const timer = setTimeout(() => {
            if (reviewRef.current?.value.reviewId === reviewId) {
                cancel();
                setMessage("reviewExpired");
            }
        }, Math.min(120000, Math.max(0, reviewExpiresAtMs - Date.now())));
        return () => clearTimeout(timer);
    }, [cancel, reviewId, reviewExpiresAtMs]);
    const prepare = async () => {
        if (busyRef.current || !target || current?.preferencesInvalid || !client.canDisplay(snapshot.generation) || !hasScreenAiChoices(draft))
            return;
        const token = invalidateRequests(), chosen = { ...draft, purposes: [...draft.purposes] };
        changeBusy("prepare");
        setMessage(null);
        try {
            await client.consume("screen_context_ai_prepare_review", { choices: chosen }, decodeScreenAiReview, (value, generation) => {
                if (!alive.current || token !== sequence.current) {
                    if (client.canDisplay(generation))
                        void client.consume("screen_context_ai_cancel_review", { reviewId: value.reviewId }, decodeScreenAiCancelled, () => { }).catch(() => { });
                    return;
                }
                if (value.recipient.modelId !== expectedModelId || !sameScreenAiChoices(value.choices, chosen)) {
                    void client.consume("screen_context_ai_cancel_review", { reviewId: value.reviewId }, decodeScreenAiCancelled, () => {}).catch(() => {});
                    throw new Error("screen_context_invalid_response");
                }
                updateReview({ value, generation });
            });
        }
        catch (error) {
            if (alive.current && token === sequence.current && !(error instanceof Error && error.message === "screen_context_account_changed"))
                setMessage("saveFailed");
        }
        finally {
            if (alive.current && token === sequence.current)
                changeBusy(null);
        }
    };
    const confirm = async () => {
        const pending = reviewRef.current;
        if (!pending || busyRef.current || !client.canDisplay(pending.generation))
            return;
        const token = invalidateRequests();
        // The explicit confirmation returns to settings immediately. OFF remains
        // available during saving; it is a separately explicit revocation request.
        // Escape only cancels the pre-confirmation review, never claims to undo an
        // already committed choice whose native acknowledgment is still in flight.
        updateReview(null);
        returnFocus();
        changeBusy("save");
        setMessage(null);
        try {
            await client.consume("screen_context_ai_confirm_review", { reviewId: pending.value.reviewId }, decodeScreenAiSaved, () => {
                if (alive.current && token === sequence.current) {
                    setMessage("saved");
                    markUnsavedOff(false);
                }
            });
        }
        catch (error) {
            if (alive.current && token === sequence.current && !(error instanceof Error && error.message === "screen_context_account_changed"))
                setMessage("saveFailed");
        }
        finally {
            if (alive.current && token === sequence.current) {
                changeBusy(null);
                void refresh();
            }
        }
    };
    const off = async () => {
        if (!client.canDisplay(snapshot.generation))
            return;
        const token = invalidateRequests();
        updateReview(null);
        setDraft(emptyScreenAiChoices());
        changeBusy("off");
        markUnsavedOff(true);
        setMessage(null);
        try {
            await client.consume("screen_context_ai_turn_off", {}, decodeScreenAiSaved, () => { if (alive.current && token === sequence.current) {
                markUnsavedOff(false);
                setMessage("saved");
            } });
        }
        catch (error) {
            if (alive.current && token === sequence.current && !(error instanceof Error && error.message === "screen_context_account_changed"))
                setMessage("unsavedOff");
        }
        finally {
            if (alive.current && token === sequence.current) {
                changeBusy(null);
                void refresh();
            }
        }
    };
    const changeSource = (key: "accessibilityText" | "ocrText" | "images", checked: boolean) => setDraft(v => ({ ...v, [key]: checked }));
    const changePurpose = (purpose: ScreenAiPurpose, checked: boolean) => setDraft(v => ({ ...v, purposes: checked ? [...v.purposes, purpose] : v.purposes.filter(p => p !== purpose) }));
    const sourceRows = ([["accessibilityText", copy.appText], ["ocrText", copy.ocr], ["images", copy.images]] as const), purposeRows = ([["classification", copy.classification], ["project_assignment", copy.projects], ["timeline_cards", copy.cards]] as const);
    const showOff = busy === "save" || busy === "off" || unsavedOff || current?.preferencesInvalid || !!current?.savedChoices && hasScreenAiChoices(current.savedChoices) || !!current?.active;
    if (!client.isDesktop()) return null;
    const preparing = !!current && !current.deliveryAvailable && !current.active && !current.preferencesInvalid && !(current.savedChoices && hasScreenAiChoices(current.savedChoices))
        && !visibleReview && busy === null && !unsavedOff && message === null;
    const visibleSources = sourceRows.filter(([key]) => key !== "images" || target?.imagesSupported);
    const locked = !target || busy !== null || !!visibleReview;
    // Choices that cannot be used yet are not offered; the card appears once delivery is available.
    if (!current || preparing) return null;
    return <section className="settings-block screen-ai-consent ph-no-capture" data-sentry-block data-setting-id="settings.screenContext.ai" data-state={preparing ? "preparing" : undefined}>
  <h3 className="screen-ai-consent__head">{t("screenRecording.ai.title")} <span className="screen-ai-consent__state" role="status">{!current ? t("screenContext.state.check") : preparing ? t("screenRecording.ai.preparing") : current.active && !unsavedOff ? copy.on : copy.off}</span></h3>
  <div className="screen-ai-consent__card">{preparing ? <p className="desc">{t("screenRecording.ai.preparingBody")}</p> : <>
  <p className="desc">{t("screenRecording.ai.body")}</p>
  <p className="screen-ai-consent__recipient">{target ? t("screenRecording.ai.recipient", { model: target.modelLabel }) : current ? t("screenRecording.ai.noModel") : t("screenContext.state.check")}{current && !target && onOpenAiSettings && <button type="button" className="settings-btn" onClick={onOpenAiSettings}>{t("sidebar.cta.ai.action")}</button>}</p>
  <fieldset className="screen-ai-consent__choices" disabled={locked}><legend>{t("screenRecording.ai.purposes")}</legend><div className="screen-ai-consent__chips">{purposeRows.map(([key, label]) => <label key={key} className="screen-ai-consent__chip"><input type="checkbox" checked={draft.purposes.includes(key)} onChange={event => changePurpose(key, event.target.checked)}/>{label}</label>)}</div></fieldset>
  <fieldset className="screen-ai-consent__choices" disabled={locked}><legend>{t("screenRecording.ai.textSources")}</legend><div className="screen-ai-consent__chips">{visibleSources.map(([key, label]) => <label key={key} className="screen-ai-consent__chip"><input type="checkbox" checked={draft[key]} onChange={event => changeSource(key, event.target.checked)}/>{label}</label>)}</div></fieldset>
  <p className="desc">{copy.privacy}</p>{current?.preferencesInvalid && <p role="status" className="desc">{copy.invalidPreferences}</p>}{current && !current.deliveryAvailable && <p className="desc">{copy.notDelivering}</p>}
  <div className="screen-ai-consent__actions"><button type="button" className="settings-btn settings-btn--primary" ref={opener} disabled={!target || !!current?.preferencesInvalid || !hasScreenAiChoices(draft) || busy !== null} onClick={() => void prepare()}>{t("screenRecording.ai.review")}</button>{showOff && <button type="button" className="settings-btn" disabled={busy === "off" || !current} onClick={() => void off()}>{t("screenRecording.ai.turnOff")}</button>}</div>
  {busy && <p role="status" className="desc">{copy.saving}</p>}{message && <p role={message === "saved" ? "status" : "alert"} className="desc">{copy[message]}</p>}{message === "loadFailed" && <button type="button" className="settings-btn" onClick={() => void refresh()}>{copy.retry}</button>}
  </>}</div>
  {createPortal(<ModalPresence onDismiss={cancel} explicitTabNavigation>{visibleReview ? <div className="auth-modal__overlay" {...dismiss}><section className="auth-modal modal-shell screen-ai-consent__dialog" data-modal-variant="compact" role="dialog" aria-modal="true" aria-labelledby="screen-ai-consent-title" aria-describedby="screen-ai-consent-description"><h2 id="screen-ai-consent-title">{copy.confirmTitle}</h2><p id="screen-ai-consent-description">{visibleReview.recipient.modelLabel} · {copy.local}</p><dl><dt>{copy.sources}</dt><dd>{sourceRows.filter(([key]) => visibleReview.choices[key]).map(([, label]) => label).join(", ")}</dd><dt>{copy.purposes}</dt><dd>{purposeRows.filter(([key]) => visibleReview.choices.purposes.includes(key)).map(([, label]) => label).join(", ")}</dd></dl><p className="desc">{copy.confirmDescription}</p>{current && !current.deliveryAvailable && <p className="desc">{copy.notDelivering}</p>}<div className="screen-ai-consent__actions"><button type="button" className="modal-btn modal-btn--ghost" onClick={cancel}>{copy.cancel}<KeyHint shortcut="escape"/></button><button type="button" className="modal-btn modal-btn--primary" onClick={() => void confirm()}>{copy.confirm}</button></div></section></div> : null}</ModalPresence>, document.body)}
 </section>;
}
