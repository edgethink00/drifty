import * as Sentry from "@sentry/react";
import { SupabaseClient } from "@supabase/supabase-js";
import { supabaseIntegration } from "@supabase/sentry-js-integration";
import type { BrowserOptions } from "@sentry/react";

import { BUILD_INFO } from "../../buildInfo";
import {
  FILTERED_VALUE,
  sanitizeSentryBreadcrumb,
  sanitizeSentryEvent,
  sanitizeSentryRecord,
  sanitizeSentrySpan,
  sanitizeSentryTags,
} from "./sentryPrivacy";

export {
  redactSentryText,
  sanitizeSentryBreadcrumb,
  sanitizeSentryEvent,
  sanitizeSentrySpan,
  sanitizeSentryValue,
} from "./sentryPrivacy";

const DEFAULT_ENVIRONMENT = "development";
const DEFAULT_TRACES_SAMPLE_RATE = 0;
const SENTRY_MAX_BREADCRUMBS = 0;
const SHORT_COMMIT_LENGTH = 12;

let sentryReady = false;

export function buildSentryRelease(appVersion: string, buildCommit: string): string {
  const version = appVersion.trim() || "unknown";
  const commit = buildCommit.trim();
  if (!commit || commit === "unknown") return `drifty-mac@${version}`;
  return `drifty-mac@${version}+${commit.slice(0, SHORT_COMMIT_LENGTH)}`;
}

export function parseSentrySampleRate(value: string | undefined): number {
  if (!value) return DEFAULT_TRACES_SAMPLE_RATE;
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return DEFAULT_TRACES_SAMPLE_RATE;
  if (parsed < 0) return 0;
  if (parsed > 1) return 1;
  return parsed;
}

export function createSentryBrowserOptions(): BrowserOptions | null {
  const dsn = import.meta.env.VITE_SENTRY_DSN?.trim();
  if (!dsn || import.meta.env.MODE === "test" || typeof window === "undefined") return null;

  const tracesSampleRate = parseSentrySampleRate(import.meta.env.VITE_SENTRY_TRACES_SAMPLE_RATE);
  const integrations = [
    Sentry.inboundFiltersIntegration(),
    Sentry.functionToStringIntegration(),
    Sentry.browserApiErrorsIntegration(),
    Sentry.globalHandlersIntegration(),
    Sentry.linkedErrorsIntegration(),
    Sentry.dedupeIntegration(),
    supabaseIntegration(SupabaseClient, Sentry, {
      breadcrumbs: false,
      errors: true,
      tracing: false,
      shouldCreateBreadcrumb: () => false,
      shouldCreateSpan: () => false,
      sanitizeBody: () => FILTERED_VALUE,
    }),
  ];
  if (tracesSampleRate > 0) {
    integrations.push(Sentry.browserTracingIntegration());
  }

  return {
    dsn,
    environment:
      import.meta.env.VITE_SENTRY_ENVIRONMENT?.trim() ||
      import.meta.env.VITE_DRIFTY_CHANNEL?.trim() ||
      import.meta.env.MODE ||
      DEFAULT_ENVIRONMENT,
    release: buildSentryRelease(BUILD_INFO.version, BUILD_INFO.commit),
    sendDefaultPii: false,
    defaultIntegrations: false,
    enableLogs: false,
    maxBreadcrumbs: SENTRY_MAX_BREADCRUMBS,
    sampleRate: 1,
    tracesSampleRate,
    tracePropagationTargets: [],
    integrations,
    beforeSend: sanitizeSentryEvent,
    beforeSendTransaction: sanitizeSentryEvent,
    beforeSendSpan: sanitizeSentrySpan,
    beforeBreadcrumb: sanitizeSentryBreadcrumb,
  };
}

export function initializeSentry(): boolean {
  if (sentryReady) return true;
  const options = createSentryBrowserOptions();
  if (!options) return false;

  try {
    Sentry.init(options);
    sentryReady = true;
    return true;
  } catch (error) {
    if (import.meta.env.DEV) {
      console.warn("[Sentry] Unable to initialize browser SDK.", error instanceof Error ? error.message : String(error));
    }
    return false;
  }
}

export function captureSentryException(
  error: unknown,
  context?: { readonly tags?: Record<string, string>; readonly extra?: Record<string, unknown> },
): boolean {
  if (!sentryReady) return false;
  try {
    Sentry.captureException(error, {
      tags: context?.tags ? sanitizeSentryTags(context.tags) : undefined,
      extra: context?.extra ? sanitizeSentryRecord(context.extra) : undefined,
    });
    return true;
  } catch (captureError) {
    if (import.meta.env.DEV) {
      console.warn(
        "[Sentry] Unable to capture exception.",
        captureError instanceof Error ? captureError.message : String(captureError),
      );
    }
    return false;
  }
}
