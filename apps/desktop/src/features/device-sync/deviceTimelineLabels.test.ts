import { describe, expect, it } from "vitest";
import { buildActivityDevices, buildRemoteDeviceLabels } from "./deviceTimelineLabels";

const fallback = (number: number) => `Synced device ${number}`;

describe("remote device filter labels", () => {
  it("keeps received records selectable with no live sync or device list", () => {
    expect([...buildRemoteDeviceLabels(new Map(), null,
      [[{ deviceId: null }], [{ deviceId: "remote-pc" }]], fallback)])
      .toEqual([["remote-pc", "Synced device 1"]]);
  });

  it("uses the cloud label when it becomes available without changing the filter id", () => {
    expect([...buildRemoteDeviceLabels(new Map([["remote-pc", "Windows PC"]]), "local",
      [[{ deviceId: "remote-pc" }]], fallback)])
      .toEqual([["remote-pc", "Windows PC"]]);
  });

  it("omits the current device and deduplicates day and range records", () => {
    expect([...buildRemoteDeviceLabels(new Map([["local", "Current"], ["remote", "Other"]]), "local",
      [[{ deviceId: "remote" }, { deviceId: "local" }], [{ deviceId: "remote" }]], fallback)])
      .toEqual([["remote", "Other"]]);
  });

  it("keeps local-only history free of the device filter", () => {
    expect(buildRemoteDeviceLabels(new Map(), null,
      [[{}, { deviceId: null }, { deviceId: "" }]], fallback).size).toBe(0);
  });

  it("assigns distinct fallback labels independent of record ordering", () => {
    const a = buildRemoteDeviceLabels(new Map(), null, [[{ deviceId: "b" }, { deviceId: "a" }]], fallback);
    const b = buildRemoteDeviceLabels(new Map(), null, [[{ deviceId: "a" }, { deviceId: "b" }]], fallback);
    expect([...a]).toEqual([["a", "Synced device 1"], ["b", "Synced device 2"]]);
    expect([...b]).toEqual([...a]);
  });
});

describe("activity device provenance", () => {
  it("keeps local-only activity free of redundant device chips", () => {
    expect(buildActivityDevices([{}, { deviceId: null }], undefined, "This device", "Synced device")).toEqual([]);
  });

  it("includes both sources when local and remote activity share a range", () => {
    expect(buildActivityDevices([{ platform: "macos" }, { deviceId: "pc", platform: "windows" }, { deviceId: "pc", platform: "windows" }],
      new Map([["pc", "Windows PC"]]), "This device", "Synced device"))
      .toEqual([{ id: null, label: "This device", platform: "macos" }, { id: "pc", label: "Windows PC", platform: "windows" }]);
  });

  it("uses the localized fallback for an unavailable remote device name", () => {
    expect(buildActivityDevices([{ deviceId: "pc" }], undefined, "이 기기", "동기화된 기기"))
      .toEqual([{ id: "pc", label: "동기화된 기기", platform: "unknown" }]);
  });

  it("keeps distinct devices with the same display name", () => {
    expect(buildActivityDevices([{ deviceId: "a", platform: "macos" }, { deviceId: "b", platform: "windows" }],
      new Map([["a", "Computer"], ["b", "Computer"]]), "This device", "Synced device"))
      .toEqual([{ id: "a", label: "Computer", platform: "macos" }, { id: "b", label: "Computer", platform: "windows" }]);
  });

  it("uses the computer fallback for conflicting platform records instead of choosing a wrong OS", () => {
    expect(buildActivityDevices([{ deviceId: "pc", platform: "macos" }, { deviceId: "pc", platform: "windows" }],
      undefined, "This device", "Synced device"))
      .toEqual([{ id: "pc", label: "Synced device", platform: "unknown" }]);
  });
});
