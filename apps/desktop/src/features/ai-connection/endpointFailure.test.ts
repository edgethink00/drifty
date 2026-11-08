import { describe, expect, it } from "vitest";

import {
  customEndpointFailureMessage,
  endpointBodyFailureDetail,
  endpointFailureAnalyticsErrorKind,
  endpointHttpFailureDetail,
  endpointTransportFailureDetail,
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

    expect(detail).toEqual({ httpStatus: status, responseKind: "http_error" });
    expect(customEndpointFailureMessage(detail)).toBe(message);
    expect(endpointFailureAnalyticsErrorKind(detail)).toBe(errorKind);
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
