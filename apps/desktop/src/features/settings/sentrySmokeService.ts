import { invoke } from "@tauri-apps/api/core";
import { captureSentryException } from "../../lib/observability/sentry";

export type SentrySmokeSurface = "renderer" | "native";

export type SentrySmokeResult = {
  readonly smokeId: string;
  readonly acceptedBySdk: boolean;
  readonly flushCompleted?: boolean;
};

type NativeSentrySmokeResponse = {
  readonly smokeId: string;
  readonly acceptedBySdk: boolean;
  readonly flushCompleted: boolean;
};

export function createSentrySmokeId(surface: SentrySmokeSurface): string {
  const randomBytes = crypto.getRandomValues(new Uint8Array(12));
  const randomToken = Array.from(randomBytes, (value) => value.toString(16).padStart(2, "0")).join("");
  return `drifty-sentry-smoke-${surface}-${randomToken}`;
}

export function captureRendererSentrySmoke(): SentrySmokeResult {
  const smokeId = createSentrySmokeId("renderer");
  const acceptedBySdk = captureSentryException(new Error(smokeId), {
    tags: {
      component: "desktop-renderer",
      diagnostic: "sentry-smoke",
      smoke_id: smokeId,
    },
    extra: {
      smokeId,
      syntheticEmail: "renderer-smoke@example.test",
      syntheticAccessToken: "synthetic-smoke-token-not-a-secret",
      syntheticUrl: "https://example.test/sentry-smoke?token=synthetic-smoke-token",
    },
  });
  return { smokeId, acceptedBySdk };
}

export async function captureNativeSentrySmoke(): Promise<SentrySmokeResult> {
  const smokeId = createSentrySmokeId("native");
  const result = await invoke<NativeSentrySmokeResponse>("sentry_capture_native_smoke", { smokeId });
  return result;
}
