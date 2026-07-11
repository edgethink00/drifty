import { useState } from "react";
import {
  captureNativeSentrySmoke,
  captureRendererSentrySmoke,
  type SentrySmokeResult,
  type SentrySmokeSurface,
} from "./sentrySmokeService";

type SmokeState =
  | { readonly status: "idle" }
  | { readonly status: "submitting"; readonly surface: SentrySmokeSurface }
  | { readonly status: "submitted"; readonly surface: SentrySmokeSurface; readonly result: SentrySmokeResult }
  | { readonly status: "failed"; readonly surface: SentrySmokeSurface; readonly message: string };

function resultText(result: SentrySmokeResult): string {
  if (!result.acceptedBySdk) return "No configured Sentry client accepted this event.";
  if (result.flushCompleted === false) return "The SDK accepted the event, but its short flush window did not complete.";
  return "The SDK accepted the event. This does not confirm arrival in Sentry.";
}

export function SentrySmokeDiagnostics() {
  const [state, setState] = useState<SmokeState>({ status: "idle" });

  const runRendererSmoke = () => {
    const result = captureRendererSentrySmoke();
    setState({ status: "submitted", surface: "renderer", result });
  };

  const runNativeSmoke = async () => {
    setState({ status: "submitting", surface: "native" });
    try {
      const result = await captureNativeSentrySmoke();
      setState({ status: "submitted", surface: "native", result });
    } catch (error) {
      setState({
        status: "failed",
        surface: "native",
        message: error instanceof Error ? error.message : String(error),
      });
    }
  };

  const locked = state.status === "submitting" || state.status === "submitted";

  return (
    <div className="settings-block settings-block--dev-preview" role="group" aria-label="Sentry smoke diagnostics">
      <h3>Sentry smoke diagnostics</h3>
      <div className="settings-row settings-row--fallback">
        <div>
          <div className="lbl">Synthetic error events</div>
          <div className="desc">
            Submit non-crashing renderer or native events, then search Sentry for the generated smoke ID. Synthetic scrubber-test values only; no activity data is attached.
          </div>
        </div>
        <div className="ctrl settings-row__actions">
          <button type="button" className="settings-btn" disabled={locked} onClick={runRendererSmoke}>Test renderer</button>
          <button type="button" className="settings-btn" disabled={locked} onClick={() => void runNativeSmoke()}>Test native</button>
        </div>
      </div>
      {state.status === "submitting" ? <div role="status">Submitting native smoke event to the SDK…</div> : null}
      {state.status === "submitted" ? (
        <div role="status">
          <div>{resultText(state.result)}</div>
          <code>{state.result.smokeId}</code>
          <div><button type="button" className="settings-btn" onClick={() => setState({ status: "idle" })}>Run another test</button></div>
        </div>
      ) : null}
      {state.status === "failed" ? <div role="alert">Native smoke submission failed: {state.message}</div> : null}
    </div>
  );
}
