// @vitest-environment jsdom

import { afterEach, describe, expect, it, vi } from "vitest";
import type { Breadcrumb, ErrorEvent } from "@sentry/react";
import type { SpanJSON } from "@sentry/core";

import {
  buildSentryRelease,
  createSentryBrowserOptions,
  parseSentrySampleRate,
  redactSentryText,
  sanitizeSentryBreadcrumb,
  sanitizeSentryEvent,
  sanitizeSentrySpan,
  sanitizeSentryValue,
} from "./sentry";

describe("Sentry desktop privacy boundary", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("disables default browser breadcrumbs for release events", () => {
    vi.stubEnv("MODE", "production");
    vi.stubEnv("VITE_SENTRY_DSN", "https://public@example.ingest.sentry.io/1");

    const options = createSentryBrowserOptions();

    expect(options).not.toBeNull();
    expect(options?.defaultIntegrations).toBe(false);
    expect(options?.maxBreadcrumbs).toBe(0);
    expect(options?.tracePropagationTargets).toEqual([]);
  });

  it("redacts direct PII, auth tokens, filesystem user paths, and URL queries", () => {
    const text = [
      "person@example.com",
      "https://project.supabase.co/auth/v1/callback?access_token=secret&refresh_token=secret#frag",
      "drifty://auth/callback?code=abc123",
      "/Users/alex/Library/Application Support/Drifty/log.txt",
      "user 2dfb73ba-b9be-40c7-9803-a20484e032d2",
    ].join(" ");

    const redacted = redactSentryText(text);

    expect(redacted).not.toContain("person@example.com");
    expect(redacted).not.toContain("access_token");
    expect(redacted).not.toContain("refresh_token");
    expect(redacted).not.toContain("code=abc123");
    expect(redacted).not.toContain("/Users/alex");
    expect(redacted).not.toContain("2dfb73ba-b9be-40c7-9803-a20484e032d2");
    expect(redacted).toContain("https://project.supabase.co/auth/v1/callback");
    expect(redacted).toContain("drifty://auth/callback");
  });

  it("filters raw activity and credential-shaped structured fields", () => {
    const value = sanitizeSentryValue({
      action: "classification",
      email: "person@example.com",
      windowTitle: "Quarterly plan draft",
      siteUrl: "https://example.com/private?token=secret",
      accessToken: "secret-token",
      nested: {
        durationSeconds: 120,
        domain: "example.com",
      },
    });

    expect(value).toEqual({
      action: "classification",
      email: "[Filtered]",
      windowTitle: "[Filtered]",
      siteUrl: "[Filtered]",
      accessToken: "[Filtered]",
      nested: {
        durationSeconds: 120,
        domain: "[Filtered]",
      },
    });
  });

  it("removes user and request context from error events while scrubbing exceptions", () => {
    const event: ErrorEvent = {
      type: undefined,
      user: { email: "person@example.com", id: "2dfb73ba-b9be-40c7-9803-a20484e032d2" },
      request: {
        url: "https://drifty.so/auth?access_token=secret",
        headers: { authorization: "Bearer secret" },
      },
      message: "Failed for person@example.com",
      exception: {
        values: [
          {
            type: "Error",
            value: "Could not load https://example.com/path?refresh_token=secret",
            stacktrace: {
              frames: [
                {
                  filename: "/Users/alex/project/file.ts",
                  abs_path: "/Users/alex/project/file.ts",
                  function: "loadPrivateWindowTitle",
                },
              ],
            },
          },
        ],
      },
      extra: {
        windowTitle: "Private document",
        note: "sent by person@example.com",
      },
    };

    const sanitized = sanitizeSentryEvent(event);

    expect(sanitized.user).toBeUndefined();
    expect(sanitized.request).toBeUndefined();
    expect(JSON.stringify(sanitized)).not.toContain("person@example.com");
    expect(JSON.stringify(sanitized)).not.toContain("refresh_token");
    expect(JSON.stringify(sanitized)).not.toContain("/Users/alex");
    expect(sanitized.extra).toMatchObject({
      windowTitle: "[Filtered]",
      note: "sent by [Email]",
    });
  });

  it("scrubs breadcrumb and span payloads that can contain Supabase filters or request data", () => {
    const breadcrumb: Breadcrumb = {
      type: "supabase",
      category: "db.select",
      message: "from(user_settings)",
      data: {
        query: ["email=eq.person@example.com", "user_id=eq.2dfb73ba-b9be-40c7-9803-a20484e032d2"],
        body: { siteUrl: "https://example.com/private?apikey=secret" },
      },
    };
    const span: SpanJSON = {
      trace_id: "trace",
      span_id: "span",
      start_timestamp: 1,
      data: {
        "db.query": "email=eq.person@example.com",
        "http.url": "https://example.com/private?apikey=secret",
        "db.table": "profiles",
      },
    };

    expect(JSON.stringify(sanitizeSentryBreadcrumb(breadcrumb))).not.toContain("person@example.com");
    expect(JSON.stringify(sanitizeSentryBreadcrumb(breadcrumb))).not.toContain("2dfb73ba");
    expect(JSON.stringify(sanitizeSentryBreadcrumb(breadcrumb))).not.toContain("apikey=secret");
    expect(JSON.stringify(sanitizeSentrySpan(span))).not.toContain("person@example.com");
    expect(JSON.stringify(sanitizeSentrySpan(span))).not.toContain("apikey=secret");
  });

  it("keeps traces off by default and builds stable release names", () => {
    expect(parseSentrySampleRate(undefined)).toBe(0);
    expect(parseSentrySampleRate("not-a-number")).toBe(0);
    expect(parseSentrySampleRate("-1")).toBe(0);
    expect(parseSentrySampleRate("2")).toBe(1);
    expect(parseSentrySampleRate("0.25")).toBe(0.25);

    expect(buildSentryRelease("1.2.16", "d1f00b6a2cc9a43278b4e3f61234567890123456")).toBe(
      "drifty-mac@1.2.16+d1f00b6a2cc9",
    );
  });
});
