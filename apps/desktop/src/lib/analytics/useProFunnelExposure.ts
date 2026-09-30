import { useEffect, useRef } from "react";
import { recordProFunnelStep, type ProFunnelStep } from "./proFunnel";
import { readProductAnalyticsEnabled, PRODUCT_ANALYTICS_PREFERENCE_CHANGED_EVENT, PRODUCT_ANALYTICS_PREFERENCE_STORAGE_KEY } from "./productAnalyticsPreference";

export const PRO_FUNNEL_EXPOSURE_MS = 1_000;

/** Conservative exposure signal, not proof of reading or satisfaction. */
export function isFunnelElementVisible(element: HTMLElement): boolean {
  if (document.visibilityState !== "visible" || !document.hasFocus()) return false;
  if (element.closest('[hidden], [inert], [aria-hidden="true"]')) return false;
  const style = getComputedStyle(element);
  if (style.display === "none" || style.visibility !== "visible" || style.opacity === "0") return false;
  // An unrelated modal means the background surface is not an impression.
  const dialogs = Array.from(document.querySelectorAll<HTMLElement>('[aria-modal="true"]'));
  if (dialogs.some((dialog) => dialog.getClientRects().length > 0 && !dialog.contains(element))) return false;
  const rect = element.getBoundingClientRect();
  const left = Math.max(0, rect.left);
  const right = Math.min(window.innerWidth, rect.right);
  const top = Math.max(0, rect.top);
  const bottom = Math.min(window.innerHeight, rect.bottom);
  if (right - left < 4 || bottom - top < 4) return false;
  const hit = document.elementFromPoint((left + right) / 2, (top + bottom) / 2);
  return hit !== null && element.contains(hit);
}

export function useProFunnelExposure<T extends HTMLElement>(
  enabled: boolean,
  step: Exclude<ProFunnelStep, { step: "checkout_opened" }> | null,
) {
  const ref = useRef<T>(null);
  const stepKey = JSON.stringify(step);
  useEffect(() => {
    if (!enabled || !step) return;
    let visibleSince: number | null = null;
    let attempted = false;
    let disposed = false;
    let completed = false;
    let timer: number | undefined;
    let preferenceGeneration = 0;
    const reset = () => { visibleSince = null; attempted = false; };
    const stopSampling = () => {
      window.clearInterval(timer);
      timer = undefined;
    };
    const canSample = () => readProductAnalyticsEnabled()
      && document.visibilityState === "visible" && document.hasFocus();
    const sample = () => {
      if (!canSample()) {
        stopSampling();
        reset();
        return;
      }
      const element = ref.current;
      const visible = element && (step.step === "classified_result_viewed"
        ? Array.from(element.querySelectorAll<HTMLElement>('[data-funnel-classified-result="true"]')).some(isFunnelElementVisible)
        : isFunnelElementVisible(element));
      if (!visible) {
        visibleSince = null;
        attempted = false;
        return;
      }
      const now = performance.now();
      visibleSince ??= now;
      if (!attempted && now - visibleSince >= PRO_FUNNEL_EXPOSURE_MS) {
        attempted = true;
        const generation = preferenceGeneration;
        void recordProFunnelStep(step).then((ok) => {
          if (ok && !disposed && generation === preferenceGeneration) {
            completed = true;
            stopSampling();
          }
        });
      }
    };
    const syncSampling = () => {
      if (!canSample()) {
        stopSampling();
        reset();
      } else if (!completed && timer === undefined) {
        sample();
        timer = window.setInterval(sample, 250);
      }
    };
    const blur = () => { stopSampling(); reset(); };
    syncSampling();
    const preferenceChanged = (event: Event) => {
      if (event instanceof StorageEvent && event.key !== null && event.key !== PRODUCT_ANALYTICS_PREFERENCE_STORAGE_KEY) return;
      preferenceGeneration += 1;
      reset();
      completed = false;
      stopSampling();
      syncSampling();
    };
    window.addEventListener("blur", blur);
    window.addEventListener("focus", syncSampling);
    document.addEventListener("visibilitychange", syncSampling);
    window.addEventListener(PRODUCT_ANALYTICS_PREFERENCE_CHANGED_EVENT, preferenceChanged);
    window.addEventListener("storage", preferenceChanged);
    return () => {
      disposed = true;
      stopSampling();
      window.removeEventListener("blur", blur);
      window.removeEventListener("focus", syncSampling);
      document.removeEventListener("visibilitychange", syncSampling);
      window.removeEventListener(PRODUCT_ANALYTICS_PREFERENCE_CHANGED_EVENT, preferenceChanged);
      window.removeEventListener("storage", preferenceChanged);
    };
    // The event consists only of enum values. Renders with equivalent props must
    // not reset the continuous exposure window.
  }, [enabled, stepKey]);
  return ref;
}
