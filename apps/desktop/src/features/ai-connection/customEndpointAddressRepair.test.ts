// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";

import {
  addressRepairCandidates,
  failureSuggestsWrongAddress,
  findWorkingEndpointAddress,
  isAddressRepairDeclined,
  readAddressRepairNotice,
  recordDeclinedAddressRepair,
  writeAddressRepairNotice,
} from "./customEndpointAddressRepair";

afterEach(() => window.localStorage.clear());

describe("custom endpoint address repair", () => {
  it.each([
    ["http://localhost:10100", ["http://localhost:10100/v1"]],
    ["http://localhost:10100/", ["http://localhost:10100/v1"]],
    ["http://localhost:1234/v1/chat/completions", ["http://localhost:1234/v1"]],
    ["http://localhost:1234/v1/models/", ["http://localhost:1234/v1"]],
    ["https://llm.example.com/chat/completions", ["https://llm.example.com/v1"]],
    ["http://localhost:11434/v1", []],
    ["http://localhost:4000/api", []],
    ["http://localhost:10100/?token=1", []],
    ["not a url", []],
  ])("tries only same-origin API addresses for %s", (baseUrl, expected) => {
    expect(addressRepairCandidates(baseUrl)).toEqual(expected);
  });

  it("repairs only after answers that point at the address", () => {
    expect(failureSuggestsWrongAddress({ httpStatus: 200, responseKind: "html" })).toBe(true);
    expect(failureSuggestsWrongAddress({ httpStatus: 200, responseKind: "not_json" })).toBe(true);
    expect(failureSuggestsWrongAddress({ httpStatus: 404, responseKind: "http_error" })).toBe(true);
    expect(failureSuggestsWrongAddress({ httpStatus: 401, responseKind: "http_error" })).toBe(false);
    expect(failureSuggestsWrongAddress({ httpStatus: 200, responseKind: "no_message" })).toBe(false);
    expect(failureSuggestsWrongAddress({ httpStatus: null, responseKind: "unreachable" })).toBe(false);
    expect(failureSuggestsWrongAddress(undefined)).toBe(false);
  });

  it("switches only to a candidate that lists models and passes the connection test", async () => {
    const listModels = vi.fn(async () => ({ models: ["gpt-6-luna--fast"] }));
    const confirm = vi.fn(async () => true);

    await expect(findWorkingEndpointAddress("http://localhost:10100", { listModels, confirm })).resolves.toBe("http://localhost:10100/v1");
    expect(listModels).toHaveBeenCalledWith("http://localhost:10100/v1");
    expect(confirm).toHaveBeenCalledWith("http://localhost:10100/v1");

    await expect(findWorkingEndpointAddress("http://localhost:10100", { listModels, confirm: async () => false })).resolves.toBeNull();
    await expect(findWorkingEndpointAddress("http://localhost:10100", { listModels: async () => ({ models: [] }) })).resolves.toBeNull();
    await expect(findWorkingEndpointAddress("http://localhost:10100", {
      listModels: async () => { throw new Error("The endpoint returned invalid JSON."); },
    })).resolves.toBeNull();
  });

  it("never repairs an address the person restored", async () => {
    const listModels = vi.fn(async () => ({ models: ["m"] }));
    recordDeclinedAddressRepair("http://localhost:10100/");

    expect(isAddressRepairDeclined("http://localhost:10100")).toBe(true);
    await expect(findWorkingEndpointAddress("http://localhost:10100", { listModels })).resolves.toBeNull();
    expect(listModels).not.toHaveBeenCalled();
  });

  it("keeps the notice across restarts until it is cleared", () => {
    writeAddressRepairNotice({ from: "http://localhost:10100", to: "http://localhost:10100/v1" });
    expect(readAddressRepairNotice()).toEqual({ from: "http://localhost:10100", to: "http://localhost:10100/v1" });
    writeAddressRepairNotice(null);
    expect(readAddressRepairNotice()).toBeNull();
  });
});
