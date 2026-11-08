import { describe, expect, it } from "vitest";

import {
  customEndpointFailureMessage,
  endpointBodyFailureDetail,
  endpointFailureAnalyticsErrorKind,
  endpointHttpFailureDetail,
  endpointTransportFailureDetail,
  readEndpointErrorBody,
} from "./endpointFailure";

const OPENCODEX_WEB_UI = "<!doctype html>\n<html lang=\"en\"><head><meta charset=\"UTF-8\" /><title>OpenCodex</title></head><body><div id=\"root\"></div></body></html>";

describe("endpoint failure detail", () => {
  it("recognizes a server's web page answered with HTTP 200, as OpenCodex does when /v1 is missing", () => {
    const detail = endpointBodyFailureDetail(200, OPENCODEX_WEB_UI);

    expect(detail).toEqual({ httpStatus: 200, responseKind: "html" });
    expect(customEndpointFailureMessage(detail)).toContain("returned a web page");
    expect(customEndpointFailureMessage(detail)).toContain("/v1");
    expect(endpointFailureAnalyticsErrorKind(detail)).toBe("configuration");
  });

  it("separates non-JSON answers from JSON without an assistant message", () => {
    expect(endpointBodyFailureDetail(200, "OK")).toEqual({ httpStatus: 200, responseKind: "not_json" });
    expect(endpointBodyFailureDetail(200, JSON.stringify({ choices: [] }))).toEqual({ httpStatus: 200, responseKind: "no_message" });
    expect(customEndpointFailureMessage({ httpStatus: 200, responseKind: "no_message" })).toBe("Provider responded, but no assistant message was returned.");
  });

  it.each([
    [401, "Provider returned HTTP 401.", "not_authenticated"],
    [404, "The endpoint returned HTTP 404. Check that the base URL ends in /v1 and that the model ID exists.", "not_found"],
    [429, "The endpoint is rate limiting requests (HTTP 429). Try again in a moment.", "rate_limited"],
    [502, "The endpoint returned a server error (HTTP 502). Check the server and the account it uses.", "unavailable"],
    [400, "Provider returned HTTP 400.", "provider_error"],
  ] as const)("explains HTTP %i from a custom endpoint", (status, message, errorKind) => {
    const detail = endpointHttpFailureDetail(status, JSON.stringify({ error: { message: "upstream text that must not be kept" } }));

    expect(detail).toEqual({ httpStatus: status, responseKind: "http_error", errorCode: "other" });
    expect(customEndpointFailureMessage(detail)).toBe(message);
    expect(endpointFailureAnalyticsErrorKind(detail)).toBe(errorKind);
  });

  it.each([
    ["OpenAI and OpenCodex", 400, { error: { message: "The requested model is not available from the provider.", type: "invalid_request_error", code: "model_not_found" } }],
    ["Ollama", 404, { error: "model 'gpt-6-luna--fast' not found" }],
    ["vLLM", 404, { object: "error", message: "The model `gpt-6-luna--fast` does not exist.", type: "NotFoundError", code: 404 }],
    ["LM Studio", 400, { error: { message: "Invalid model identifier \"gpt-6-luna--fast\". Unknown model.", type: "invalid_request_error" } }],
  ] as const)("recognizes a missing model in the %s error shape", (_server, status, body) => {
    const detail = endpointHttpFailureDetail(status, JSON.stringify(body));

    expect(detail.errorCode).toBe("model_not_found");
    expect(customEndpointFailureMessage(detail, { model: "gpt-6-luna--fast" })).toBe(
      'The endpoint does not have the model "gpt-6-luna--fast". Use Fetch models to choose one it lists.',
    );
    expect(endpointFailureAnalyticsErrorKind(detail)).toBe("not_found");
  });

  it("shows the server's own reason on screen, clipped to one line, and keeps it out of the detail", () => {
    const body = JSON.stringify({ error: { message: "Your session expired.\nRun ocx login to sign in again.", code: "invalid_api_key" } });
    const detail = endpointHttpFailureDetail(401, body);
    const server = readEndpointErrorBody(body);

    expect(detail).toEqual({ httpStatus: 401, responseKind: "http_error", errorCode: "authentication" });
    expect(server?.message).toBe("Your session expired. Run ocx login to sign in again.");
    expect(customEndpointFailureMessage(detail, { serverMessage: server?.message })).toBe(
      "The endpoint returned HTTP 401: Your session expired. Run ocx login to sign in again.",
    );
    expect(readEndpointErrorBody(JSON.stringify({ error: { message: "x".repeat(500) } }))?.message).toHaveLength(200);
    expect(readEndpointErrorBody("<html><head></head></html>")).toBeNull();
    expect(readEndpointErrorBody(JSON.stringify({ choices: [] }))).toBeNull();
  });

  it("treats an HTML error page as a wrong address whatever its status", () => {
    expect(endpointHttpFailureDetail(404, "<html><head><title>404</title></head></html>")).toEqual({ httpStatus: 404, responseKind: "html" });
  });

  it("keeps the original message for transport failures and only records their kind", () => {
    const timeout = endpointTransportFailureDetail("error sending request for url (http://localhost:10100/v1/chat/completions): operation timed out");
    const refused = endpointTransportFailureDetail("error sending request for url (http://localhost:10100/v1/chat/completions)");

    expect(timeout).toEqual({ httpStatus: null, responseKind: "timeout" });
    expect(refused).toEqual({ httpStatus: null, responseKind: "unreachable" });
    expect(customEndpointFailureMessage(refused)).toBeNull();
    expect(endpointFailureAnalyticsErrorKind(timeout)).toBe("timeout");
    expect(endpointFailureAnalyticsErrorKind(refused)).toBe("network");
  });
});
