import { useCapturePolicySync } from "./capturePolicy";
import { useUiZoomRuntime } from "./uiZoom";

/**
 * Side effects for the 2026-10-25 feedback-request settings, mounted once in
 * the main window: the tracker's copy of the capture policy and the window size.
 */
export function FeedbackRequestsRuntime() {
  useCapturePolicySync();
  useUiZoomRuntime();
  return null;
}
