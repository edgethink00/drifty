// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useLocalization } from "../localization/LocalizationContext";
import { driftyModelOptions } from "./AiSetupDriftyModelOptions";
import { MANAGED_LOCAL_AI_FALLBACK_CATALOG } from "./managedLocalAiCatalog";
import { managedModelResourceDescription } from "./managedModelPresentation";
import { SettingsSelect } from "./SettingsSelect";
import { ENGLISH_TRANSLATIONS } from "../localization/translations";
import type { ManagedLocalAiStatus } from "./managedLocalAiClient";

afterEach(() => {
  cleanup();
  vi.unstubAllEnvs();
});

describe("managed model requirements in settings", () => {
  beforeEach(() => {
    vi.stubEnv("VITE_DRIFTY_HOST_PLATFORM", "macos");
  });

  it("names File Explorer for the installed-model reveal action on Windows", () => {
    vi.stubEnv("VITE_DRIFTY_HOST_PLATFORM", "windows");
    const model = MANAGED_LOCAL_AI_FALLBACK_CATALOG[0];
    const option = driftyModelOptions({
      catalog: MANAGED_LOCAL_AI_FALLBACK_CATALOG,
      actionModelId: null,
      cloudSubscribeActionDisabled: false, cloudSubscribeActionLabel: "Upgrade",
      cloudSelectable: false, canManageBilling: false,
      onInstallModel: vi.fn(), onStartModel: vi.fn(), onStartCloudSetup: vi.fn(), onManageCloudBilling: vi.fn(),
      onDeleteModel: vi.fn(), onRevealArtifact: vi.fn(),
      t: ((key: keyof typeof ENGLISH_TRANSLATIONS, values?: Record<string, string>) =>
        ENGLISH_TRANSLATIONS[key].replace("{{model}}", values?.model ?? "")) as never,
      status: {
        state: "installed", selectedModelId: model.id, installedModels: [{ id: model.id, artifactDir: "C:\\qa-model" }],
        baseUrl: null, model: null, message: "", artifactDir: null,
        progress: null, errorKind: null, memoryUsageBytes: null,
      },
    })[1];

    expect(option.actions?.find((action) => action.key === "reveal")?.label).toBe(`Show ${model.label} in File Explorer`);
  });

  it("keeps idle downloads on hover while showing progress, retries, and installed-model management", () => {
    const base = {
      catalog: MANAGED_LOCAL_AI_FALLBACK_CATALOG,
      actionModelId: null,
      cloudSubscribeActionDisabled: false, cloudSubscribeActionLabel: "Upgrade",
      cloudSelectable: false, canManageBilling: false,
      onInstallModel: vi.fn(), onStartModel: vi.fn(), onStartCloudSetup: vi.fn(), onManageCloudBilling: vi.fn(),
      onDeleteModel: vi.fn(), onRevealArtifact: vi.fn(),
      t: (key: keyof typeof ENGLISH_TRANSLATIONS) => ENGLISH_TRANSLATIONS[key],
    };
    const idle = driftyModelOptions({ ...base, status: null });
    expect(idle[0].actionTone).toBe("primary");
    expect(idle[1].actionOnHover).toBe(true);
    expect(idle[1].actionBusy).toBe(false);
    expect(idle[1].actionTone).toBeUndefined();
    const modelId = MANAGED_LOCAL_AI_FALLBACK_CATALOG[0].id;
    const status: ManagedLocalAiStatus = {
      state: "installing", selectedModelId: modelId, installedModels: [],
      baseUrl: null, model: null, message: "", artifactDir: null,
      progress: null, errorKind: null, memoryUsageBytes: null,
    };
    const progressOption = driftyModelOptions({ ...base, status })[1];
    expect(progressOption.actionOnHover).toBe(false);
    expect(progressOption.actionBusy).toBe(true);
    expect(progressOption.actionDisabled).toBe(true);
    expect(driftyModelOptions({ ...base, status: { ...status, state: "error", errorKind: "download_failed" } })[1].actionOnHover).toBe(false);
    const installed = driftyModelOptions({
      ...base,
      status: { ...status, state: "installed", installedModels: [{ id: modelId, artifactDir: "/tmp/qa-model" }] },
    })[1];
    expect(installed.statusLabel).toBe("Installed");
    expect(installed.description).not.toContain("Installed");
    expect(installed.actionLabel).toBeUndefined();
    expect(installed.actions?.map((action) => action.key)).toEqual(["reveal", "delete"]);
    expect(installed.actions?.every((action) => !action.onHover)).toBe(true);
    const preparing = driftyModelOptions({
      ...base,
      status: {
        ...status,
        artifactDir: "/tmp/qa-model",
        installedModels: [{ id: modelId, artifactDir: "/tmp/qa-model" }],
      },
    })[1];
    expect(preparing.statusLabel).toBe("Preparing");
    expect(preparing.disabled).toBe(true);
    const running = driftyModelOptions({
      ...base,
      status: { ...status, state: "running", installedModels: [{ id: modelId, artifactDir: "/tmp/qa-model" }] },
    })[1];
    expect(running.statusLabel).toBe("In use");
    expect(running.actions?.every((action) => !action.onHover)).toBe(true);

    const retryStart = vi.fn();
    const runtimeFailure = driftyModelOptions({
      ...base,
      onStartModel: retryStart,
      status: {
        ...status,
        state: "error",
        errorKind: "runtime_port_conflict",
        installedModels: [{ id: modelId, artifactDir: "/tmp/qa-model" }],
      },
    })[1];
    expect(runtimeFailure.actions?.map((action) => action.key)).toEqual([
      "retry-runtime",
      "reveal",
      "delete",
    ]);
    runtimeFailure.actions?.[0].onAction();
    expect(retryStart).toHaveBeenCalledWith(modelId);
    const runtimeDownloadFailure = driftyModelOptions({
      ...base,
      status: {
        ...status,
        state: "error",
        errorKind: "runtime_download_failed",
        installedModels: [{ id: modelId, artifactDir: "/tmp/qa-model" }],
      },
    })[1];
    expect(runtimeDownloadFailure.actions?.map((action) => action.key)).toEqual([
      "retry-runtime",
      "reveal",
      "delete",
    ]);

    render(<SettingsSelect ariaLabel="AI model" value="drifty_cloud" options={[idle[0], installed]} onChange={vi.fn()} />);
    fireEvent.click(screen.getByRole("combobox", { name: "AI model" }));
    const installedLabel = screen.getByText("Installed");
    const installedOption = screen.getByRole("option", { name: installed.displayLabel });
    expect(installedOption.contains(installedLabel)).toBe(true);
    expect(installedOption.getAttribute("aria-describedby")?.split(" ")).toContain(installedLabel.id);
    expect(installedLabel.closest(".settings-select-control__option-actions")).toBeNull();
  });

  it("replaces the downloading row's static size blurb with live transfer progress", () => {
    const t = (key: keyof typeof ENGLISH_TRANSLATIONS) => ENGLISH_TRANSLATIONS[key];
    const base = {
      catalog: MANAGED_LOCAL_AI_FALLBACK_CATALOG,
      actionModelId: null,
      cloudSubscribeActionDisabled: false, cloudSubscribeActionLabel: "Upgrade",
      cloudSelectable: false, canManageBilling: false,
      onInstallModel: vi.fn(), onStartModel: vi.fn(), onStartCloudSetup: vi.fn(), onManageCloudBilling: vi.fn(),
      onDeleteModel: vi.fn(), onRevealArtifact: vi.fn(),
      t,
    };
    const model = MANAGED_LOCAL_AI_FALLBACK_CATALOG[0];
    const status: ManagedLocalAiStatus = {
      state: "installing", selectedModelId: model.id, installedModels: [],
      baseUrl: null, model: null, message: "", artifactDir: null,
      progress: { percent: 44, downloadedBytes: 1_200_000_000, totalBytes: 2_740_937_888 },
      errorKind: null, memoryUsageBytes: null,
    };

    expect(driftyModelOptions({ ...base, status, downloadRemainingLabel: "about 3 min left" })[1].description)
      .toBe("1.2/2.7 GB · about 3 min left");
    // Without a trustworthy estimate the row still reports what has arrived.
    expect(driftyModelOptions({ ...base, status })[1].description).toBe("1.2/2.7 GB");
    // An idle row keeps the memory-and-size guidance that helps someone choose.
    expect(driftyModelOptions({ ...base, status: null })[1].description)
      .toBe(managedModelResourceDescription(model, t));
  });
  it("exposes requirements and prevents unsupported downloads while allowing a fitting model", () => {
    const install = vi.fn();
    function Harness() {
      const { t } = useLocalization();
      const options = driftyModelOptions({
        catalog: MANAGED_LOCAL_AI_FALLBACK_CATALOG.map((model, index) => ({
          ...model, fit: index === 3 ? "insufficient" : "good",
        })),
        status: null, actionModelId: null,
        cloudSubscribeActionDisabled: false, cloudSubscribeActionLabel: null,
        cloudSelectable: true, canManageBilling: false,
        onInstallModel: install, onStartModel: vi.fn(), onStartCloudSetup: vi.fn(), onManageCloudBilling: vi.fn(),
        onDeleteModel: vi.fn(), onRevealArtifact: vi.fn(), t,
      });
      return <SettingsSelect ariaLabel="AI model" value="drifty_cloud" options={options} onChange={vi.fn()} />;
    }
    render(<Harness />);
    fireEvent.click(screen.getByRole("combobox", { name: "AI model" }));
    const unsupported = screen.getByRole("option", { name: "Qwen 3.6 27B · Maximum" });
    const description = document.getElementById(unsupported.getAttribute("aria-describedby") ?? "");
    expect(description?.textContent).toContain("Not enough memory on this device");
    expect(description?.textContent).toContain("Estimated memory");
    const blocked = screen.getByRole("button", { name: "Download Qwen 3.6 27B managed local model" });
    expect(blocked).toHaveProperty("disabled", true);
    fireEvent.click(blocked);
    expect(install).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "Download Qwen 3.5 2B managed local model" }));
    expect(install).toHaveBeenCalledWith("drifty-qwen3-5-2b-economy");
  });
});
