// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { LocalizationTestProvider } from "../localization/LocalizationContext";
import { SidebarCtaSlot, resolveSidebarCtaSlot } from "./SidebarCtaSlot";
import { resolveClassificationAvailability } from "../classification/classificationAvailability";

const activeEntitlement = {
  plan: "individual",
  status: "active",
  canUseApp: true,
  trialEndsAt: null,
  currentPeriodEnd: null,
} as const;

const NOW = Date.parse("2026-07-29T00:00:00.000Z");

const baseInput = {
  billingCheckoutLoading: false,
  billingEntitlementError: null,
  billingEntitlementLoading: false,
  localAiProvider: "managed_local",
  localAiConfigured: true,
  localAiDisconnectConfirmed: true,
  now: NOW,
} as const;

afterEach(cleanup);

describe("SidebarCtaSlot", () => {
  it("keeps a ready managed local route out of the expired-Cloud lock state", () => {
    const billingEntitlement = { ...activeEntitlement, status: "locked", canUseApp: false, lockedReason: "trial_expired" } as const;
    const classificationAvailability = resolveClassificationAvailability({
      route: "local",
      localProviderStatus: { kind: "connected" },
      localConsecutiveFailures: 0,
      localDisconnectConfirmed: false,
      cloudOnline: true,
      cloudConfigured: true,
      cloudAuthenticated: true,
      billingEntitlement,
      billingEntitlementLoading: false,
      billingEntitlementError: null,
      cloudConnectionCheck: null,
    });

    expect(resolveSidebarCtaSlot({
      ...baseInput,
      aiStatus: { issueKind: null, label: "Connected", providerLabel: "Local AI", tone: "ok" },
      billingEntitlement,
      classificationAvailability,
    })).toMatchObject({ kind: "upgrade", alert: null, titleKey: "sidebar.cta.upgrade.localTitle" });
  });

  it("prioritizes a managed model download over billing and AI actions", () => {
    expect(resolveSidebarCtaSlot({
      ...baseInput,
      aiStatus: { issueKind: "network", label: "Connection issue", providerLabel: "Drifty Cloud", tone: "warning" },
      billingEntitlement: { ...activeEntitlement, status: "locked", canUseApp: false, lockedReason: "payment_required" },
      managedLocalAiStatus: {
        state: "installing",
        selectedModelId: "drifty-qwen3-5-4b-default",
        installedModels: [],
        baseUrl: null,
        model: null,
        message: "Downloading managed local model... (42%)",
        artifactDir: null,
        progress: { percent: 42.4, downloadedBytes: 1_176_000_000, totalBytes: 2_800_000_000 },
        errorKind: null,
        memoryUsageBytes: null,
      },
    })).toMatchObject({
      kind: "download",
      modelLabel: "Qwen 3.5 4B",
      downloadSizeLabel: "~2.8 GB",
      progressPercent: 42,
      progressText: "1.2/2.8 GB",
      titleKey: "sidebar.cta.download.title",
    });
  });

  it("clamps managed model progress to the progressbar range", () => {
    expect(resolveSidebarCtaSlot({
      ...baseInput,
      aiStatus: { issueKind: null, label: "AI setup needed", providerLabel: "Open settings", tone: "error" },
      billingEntitlement: activeEntitlement,
      managedLocalAiStatus: {
        state: "installing",
        selectedModelId: "drifty-qwen3-5-4b-default",
        installedModels: [],
        baseUrl: null,
        model: null,
        message: "Downloading managed local model...",
        artifactDir: null,
        progress: { percent: 101.4, downloadedBytes: 2_800_000_000, totalBytes: 2_800_000_000 },
        errorKind: null,
        memoryUsageBytes: null,
      },
    })).toMatchObject({ kind: "download", progressPercent: 100 });
  });

  it("prioritizes a confirmed AI disconnection", () => {
    expect(resolveSidebarCtaSlot({
      ...baseInput,
      aiStatus: { issueKind: "network", label: "Connection issue", providerLabel: "Drifty Cloud", tone: "warning" },
      billingEntitlement: activeEntitlement,
    })).toMatchObject({
      kind: "ai",
      titleKey: "sidebar.cta.ai.networkTitle",
      copyKey: "sidebar.cta.ai.networkRetryDetail",
      providerLabel: "Local AI",
      actionLabelKey: "sidebar.cta.ai.action",
      alert: "critical",
    });
  });

  it("keeps a first configured-provider network failure out of the sidebar", () => {
    expect(resolveSidebarCtaSlot({
      ...baseInput,
      aiStatus: { issueKind: "network", label: "Reconnecting", providerLabel: "DeepSeek V4 Flash BYOK", tone: "warning" },
      billingEntitlement: activeEntitlement,
      localAiDisconnectConfirmed: false,
      localAiProvider: "openrouter_byok",
    })).toBeNull();
  });

  it("surfaces an explicit provider issue without waiting for network confirmation", () => {
    expect(resolveSidebarCtaSlot({
      ...baseInput,
      aiStatus: { issueKind: "provider", label: "Issue", providerLabel: "DeepSeek V4 Flash BYOK", tone: "error" },
      billingEntitlement: activeEntitlement,
      localAiDisconnectConfirmed: false,
      localAiProvider: "openrouter_byok",
    })).toMatchObject({ kind: "ai", titleKey: "sidebar.cta.ai.providerTitle" });
  });

  it.each([
    ["authentication", "sidebar.cta.ai.authenticationTitle", "sidebar.cta.ai.authenticationDetail"],
    ["credits", "sidebar.cta.ai.creditsTitle", "sidebar.cta.ai.creditsDetail"],
    ["access", "sidebar.cta.ai.accessTitle", "sidebar.cta.ai.accessDetail"],
    ["model_unavailable", "sidebar.cta.ai.modelUnavailableTitle", "sidebar.cta.ai.modelUnavailableDetail"],
  ] as const)("surfaces the typed OpenRouter %s recovery immediately", (issueKind, titleKey, copyKey) => {
    expect(resolveSidebarCtaSlot({
      ...baseInput,
      aiStatus: { issueKind, label: "Needs attention", providerLabel: "DeepSeek V4 Flash BYOK", tone: "error" },
      billingEntitlement: activeEntitlement,
      localAiDisconnectConfirmed: false,
      localAiProvider: "openrouter_byok",
    })).toMatchObject({ kind: "ai", titleKey, copyKey, providerLabel: "OpenRouter" });
  });

  it.each(["rate_limited", "unavailable"] as const)("keeps transient OpenRouter %s out of the sidebar", (issueKind) => {
    expect(resolveSidebarCtaSlot({
      ...baseInput,
      aiStatus: { issueKind, label: "Automatic retry", providerLabel: "DeepSeek V4 Flash BYOK", tone: "warning" },
      billingEntitlement: activeEntitlement,
      localAiDisconnectConfirmed: true,
      localAiProvider: "openrouter_byok",
    })).toBeNull();
  });

  it.each([
    ["download_failed", "sidebar.cta.ai.localDownloadFailedTitle", "sidebar.cta.ai.localDownloadFailedDetail"],
    ["model_artifact_missing", "sidebar.cta.ai.localModelMissingTitle", "sidebar.cta.ai.localModelMissingDetail"],
    ["insufficient_memory", "sidebar.cta.ai.localMemoryTitle", "sidebar.cta.ai.localMemoryDetail"],
    ["insufficient_storage", "sidebar.cta.ai.localStorageTitle", "sidebar.cta.ai.localStorageDetail"],
    ["runtime_missing", "sidebar.cta.ai.localRuntimeMissingTitle", "sidebar.cta.ai.localRuntimeMissingDetail"],
    ["runtime_failed", "sidebar.cta.ai.localRuntimeFailedTitle", "sidebar.cta.ai.localRuntimeFailedDetail"],
  ] as const)("surfaces the structured managed-local %s recovery", (errorKind, titleKey, copyKey) => {
    expect(resolveSidebarCtaSlot({
      ...baseInput,
      aiStatus: { issueKind: null, label: "Connected", providerLabel: "Qwen 3.5 4B", tone: "ok" },
      billingEntitlement: activeEntitlement,
      managedLocalAiStatus: {
        state: "error",
        selectedModelId: "drifty-qwen3-5-4b-default",
        installedModels: [],
        baseUrl: null,
        model: null,
        message: "Managed local model failed.",
        artifactDir: null,
        progress: null,
        errorKind,
        memoryUsageBytes: null,
      },
    })).toMatchObject({
      kind: "ai",
      titleKey,
      copyKey,
      providerLabel: "Local AI",
      actionLabelKey: "sidebar.cta.ai.action",
      alert: "critical",
    });
  });

  it("does not infer a managed-local recovery from an untyped error", () => {
    expect(resolveSidebarCtaSlot({
      ...baseInput,
      aiStatus: { issueKind: null, label: "Connected", providerLabel: "Qwen 3.5 4B", tone: "ok" },
      billingEntitlement: activeEntitlement,
      managedLocalAiStatus: {
        state: "error",
        selectedModelId: "drifty-qwen3-5-4b-default",
        installedModels: [],
        baseUrl: null,
        model: null,
        message: "Unknown local AI error.",
        artifactDir: null,
        progress: null,
        errorKind: null,
        memoryUsageBytes: null,
      },
    })).toBeNull();
  });

  it("does not show a stale managed-local error while OpenRouter is selected", () => {
    expect(resolveSidebarCtaSlot({
      ...baseInput,
      aiStatus: { issueKind: null, label: "Connected", providerLabel: "OpenRouter", tone: "ok" },
      billingEntitlement: activeEntitlement,
      localAiProvider: "openrouter_byok",
      managedLocalAiStatus: {
        state: "error",
        selectedModelId: "drifty-qwen3-5-4b-default",
        installedModels: [],
        baseUrl: null,
        model: null,
        message: "Managed local model download failed.",
        artifactDir: null,
        progress: null,
        errorKind: "download_failed",
        memoryUsageBytes: null,
      },
    })).toBeNull();
  });

  it.each([
    ["openrouter_byok", true, "DeepSeek V4 Flash BYOK", "OpenRouter", "sidebar.cta.ai.networkRetryDetail"],
    ["self_hosted", true, "llama3.1:8b", "Local AI", "sidebar.cta.ai.networkRetryDetail"],
    ["managed_local", true, "Qwen 3.5 4B", "Local AI", "sidebar.cta.ai.networkRetryDetail"],
    ["managed_local", false, "Drifty Cloud", "Drifty Cloud", "sidebar.cta.ai.networkDetail"],
  ] as const)(
    "uses a precise recovery name and network guidance for %s (configured: %s)",
    (localAiProvider, localAiConfigured, statusProviderLabel, providerLabel, copyKey) => {
      expect(resolveSidebarCtaSlot({
        ...baseInput,
        aiStatus: { issueKind: "network", label: "Connection issue", providerLabel: statusProviderLabel, tone: "warning" },
        billingEntitlement: activeEntitlement,
        localAiConfigured,
        localAiProvider,
      })).toMatchObject({
        kind: "ai",
        titleKey: "sidebar.cta.ai.networkTitle",
        copyKey,
        providerLabel,
      });
    },
  );

  it.each([
    ["openrouter_byok", "DeepSeek V4 Flash BYOK", "OpenRouter"],
    ["self_hosted", "llama3.1:8b", "Local AI"],
    ["managed_local", "Qwen 3.5 4B", "Local AI"],
  ] as const)("keeps %s provider failures generic without guessing auth or quota", (localAiProvider, statusProviderLabel, providerLabel) => {
    expect(resolveSidebarCtaSlot({
      ...baseInput,
      aiStatus: { issueKind: "provider", label: "Issue", providerLabel: statusProviderLabel, tone: "error" },
      billingEntitlement: activeEntitlement,
      localAiProvider,
    })).toMatchObject({
      kind: "ai",
      titleKey: "sidebar.cta.ai.providerTitle",
      copyKey: "sidebar.cta.ai.providerDetail",
      providerLabel,
    });
  });

  it("sells accuracy to a free user already running a local model", () => {
    expect(resolveSidebarCtaSlot({
      ...baseInput,
      aiStatus: { issueKind: null, label: "AI setup needed", providerLabel: "Open settings", tone: "error" },
      billingEntitlement: null,
    })).toMatchObject({
      kind: "upgrade",
      titleKey: "sidebar.cta.upgrade.localTitle",
      actionLabelKey: "sidebar.cta.upgrade.action",
      alert: null,
    });
  });

  it("sells the capability itself when no provider is configured", () => {
    expect(resolveSidebarCtaSlot({
      ...baseInput,
      aiStatus: { issueKind: null, label: "AI setup needed", providerLabel: "Open settings", tone: "error" },
      billingEntitlement: null,
      localAiConfigured: false,
    })).toMatchObject({ kind: "upgrade", titleKey: "sidebar.cta.upgrade.noAiTitle" });
  });

  // Someone who brought their own key or runs their own endpoint has already
  // opted out of paying us for inference, so there is nothing to sell.
  it.each(["openrouter_byok", "self_hosted"] as const)("stays empty for %s free users", (localAiProvider) => {
    expect(resolveSidebarCtaSlot({
      ...baseInput,
      aiStatus: { issueKind: null, label: "AI setup needed", providerLabel: "Open settings", tone: "error" },
      billingEntitlement: null,
      localAiProvider,
    })).toBeNull();
  });

  it("does not turn an unrelated Cloud billing failure into a BYOK recovery CTA", () => {
    expect(resolveSidebarCtaSlot({
      ...baseInput,
      aiStatus: { issueKind: "network", label: "Connection issue", providerLabel: "Drifty Cloud", tone: "warning" },
      billingEntitlement: null,
      billingEntitlementError: "Network connection failed while checking billing.",
      localAiConfigured: false,
      localAiProvider: "openrouter_byok",
    })).toBeNull();
  });

  it.each(["openrouter_byok", "self_hosted"] as const)("hides expired Cloud monetization from %s users", (localAiProvider) => {
    expect(resolveSidebarCtaSlot({
      ...baseInput,
      aiStatus: { issueKind: null, label: "Connected", providerLabel: "Drifty Cloud", tone: "ok" },
      billingEntitlement: { ...activeEntitlement, status: "locked", canUseApp: false, lockedReason: "trial_expired" },
      localAiProvider,
    })).toBeNull();
  });

  it("still recovers a disconnected BYOK provider without showing Cloud monetization", () => {
    expect(resolveSidebarCtaSlot({
      ...baseInput,
      aiStatus: { issueKind: "provider", label: "Issue", providerLabel: "Drifty Cloud", tone: "error" },
      billingEntitlement: { ...activeEntitlement, status: "locked", canUseApp: false, lockedReason: "trial_expired" },
      localAiProvider: "openrouter_byok",
    })).toMatchObject({ kind: "ai", actionLabelKey: "sidebar.cta.ai.action" });
  });

  it("counts down the trial and escalates the alert as it closes", () => {
    const trialing = (trialEndsAt: string) => resolveSidebarCtaSlot({
      ...baseInput,
      aiStatus: { issueKind: null, label: "Connected", providerLabel: "Drifty Cloud", tone: "ok" },
      billingEntitlement: { ...activeEntitlement, status: "trialing", trialEndsAt },
    });

    expect(trialing("2026-08-01T00:00:00.000Z")).toMatchObject({
      kind: "trial",
      titleKey: "sidebar.cta.trial.title",
      titleEmphasisCount: 3,
      actionLabelKey: "sidebar.cta.upgrade.action",
      alert: null,
    });
    expect(trialing("2026-07-31T00:00:00.000Z")).toMatchObject({ titleEmphasisCount: 2, alert: "warn" });
    expect(trialing("2026-07-30T00:00:00.000Z")).toMatchObject({ titleEmphasisCount: 1, alert: "critical" });
  });

  it("keeps an elapsed Cloud trial in the ended state before the backend lock arrives", () => {
    expect(resolveSidebarCtaSlot({
      ...baseInput,
      aiStatus: { issueKind: null, label: "Connected", providerLabel: "Drifty Cloud", tone: "ok" },
      billingEntitlement: { ...activeEntitlement, status: "trialing", trialEndsAt: "2026-07-28T00:00:00.000Z" },
    })).toMatchObject({
      kind: "trial-ended",
      titleKey: "sidebar.cta.trialEnded.title",
      actionLabelKey: "sidebar.cta.upgrade.action",
    });
  });

  it("surfaces each locked reason with its own recovery action", () => {
    const locked = (lockedReason: "trial_expired" | "payment_required" | "billing_missing" | "device_limit_reached") => resolveSidebarCtaSlot({
      ...baseInput,
      aiStatus: { issueKind: null, label: "Connected", providerLabel: "Drifty Cloud", tone: "ok" },
      billingEntitlement: { ...activeEntitlement, status: "locked", canUseApp: false, lockedReason },
    });

    expect(locked("trial_expired")).toMatchObject({
      kind: "trial-ended",
      titleKey: "sidebar.cta.trialEnded.title",
      actionLabelKey: "sidebar.cta.upgrade.action",
      alert: "critical",
    });
    expect(locked("payment_required")).toMatchObject({
      kind: "billing",
      titleKey: "sidebar.cta.billing.title",
      actionLabelKey: "sidebar.cta.billing.action",
    });
    expect(locked("billing_missing")).toMatchObject({
      kind: "upgrade",
      titleKey: "sidebar.cta.upgrade.noAiTitle",
      actionLabelKey: "sidebar.cta.upgrade.action",
    });
    expect(locked("device_limit_reached")).toMatchObject({
      kind: "device-limit",
      titleKey: "sidebar.cta.device.title",
      actionLabelKey: "sidebar.cta.device.action",
      alert: "warn",
    });
  });

  it("prioritizes an explicit billing lock over a simultaneous AI warning", () => {
    expect(resolveSidebarCtaSlot({
      ...baseInput,
      aiStatus: { issueKind: "network", label: "Connection issue", providerLabel: "Drifty Cloud", tone: "warning" },
      billingEntitlement: { ...activeEntitlement, status: "locked", canUseApp: false, lockedReason: "payment_required" },
    })).toMatchObject({ kind: "billing", titleKey: "sidebar.cta.billing.title" });
  });

  it("does not mistake an unresolved entitlement request for a free account or AI disconnect", () => {
    expect(resolveSidebarCtaSlot({
      ...baseInput,
      aiStatus: { issueKind: "network", label: "Connection issue", providerLabel: "Drifty Cloud", tone: "warning" },
      billingEntitlement: null,
      billingEntitlementError: "Network connection failed while checking billing.",
      localAiConfigured: false,
    })).toBeNull();
  });

  it("still surfaces a configured local provider failure during a billing request failure", () => {
    expect(resolveSidebarCtaSlot({
      ...baseInput,
      aiStatus: { issueKind: "provider", label: "Issue", providerLabel: "Drifty Cloud", tone: "error" },
      billingEntitlement: null,
      billingEntitlementError: "Network connection failed while checking billing.",
      localAiConfigured: true,
    })).toMatchObject({ kind: "ai" });
  });

  it("stays empty for a healthy active plan", () => {
    expect(resolveSidebarCtaSlot({
      ...baseInput,
      aiStatus: { issueKind: null, label: "Connected", providerLabel: "Drifty Cloud", tone: "ok" },
      billingEntitlement: activeEntitlement,
    })).toBeNull();
  });

  it("renders one accessible whole-surface action", () => {
    const onAction = vi.fn();
    const onDismiss = vi.fn();
    render(<SidebarCtaSlot
      state={{
        actionLabelKey: "sidebar.cta.upgrade.action",
        alert: "warn",
        copyKey: "sidebar.cta.trial.detail",
        direction: "external",
        disabled: false,
        kind: "trial",
        titleKey: "sidebar.cta.trial.title",
        titleEmphasisCount: 2,
        tone: "trial",
      }}
      onAction={onAction}
      onDismiss={onDismiss}
    />);

    const action = screen.getByRole("button", { name: /Trial ends in 2 days.*Upgrade to Pro/i });
    expect(action.getAttribute("data-kind")).toBe("trial");
    expect(action.getAttribute("data-alert")).toBe("warn");
    expect(action.textContent).toContain("2 days");
    fireEvent.click(action);
    expect(onAction).toHaveBeenCalledTimes(1);

    fireEvent.click(screen.getByRole("button", { name: "Dismiss upgrade" }));
    expect(onDismiss).toHaveBeenCalledTimes(1);
  });

  it("renders concise OpenRouter network recovery copy", () => {
    const state = resolveSidebarCtaSlot({
      ...baseInput,
      aiStatus: { issueKind: "network", label: "Connection issue", providerLabel: "DeepSeek V4 Flash BYOK", tone: "warning" },
      billingEntitlement: activeEntitlement,
      localAiProvider: "openrouter_byok",
    });
    if (!state) throw new Error("Expected OpenRouter recovery state");

    render(<SidebarCtaSlot state={state} onAction={vi.fn()} />);

    expect(screen.getByRole("button", {
      name: /OpenRouter connection issue.*Activity tracking continues.*retry automatically.*Open AI settings/i,
    })).toBeTruthy();
  });

  it("localizes self-hosted recovery copy with a stable Local AI label", () => {
    const state = resolveSidebarCtaSlot({
      ...baseInput,
      aiStatus: { issueKind: "provider", label: "Issue", providerLabel: "llama3.1:8b", tone: "error" },
      billingEntitlement: activeEntitlement,
      localAiProvider: "self_hosted",
    });
    if (!state) throw new Error("Expected self-hosted recovery state");

    render(
      <LocalizationTestProvider language="ko">
        <SidebarCtaSlot state={state} onAction={vi.fn()} />
      </LocalizationTestProvider>,
    );

    expect(screen.getByRole("button", {
      name: /Local AI 설정 확인 필요.*활동 추적은 계속됩니다.*AI 설정에서 Local AI 상태를 확인해 주세요.*AI 설정 열기/,
    })).toBeTruthy();
  });

  it.each([
    [
      "download_failed",
      /Local AI download failed.*Activity tracking continues.*Retry the model download in AI settings.*Open AI settings/i,
    ],
    [
      "model_artifact_missing",
      /Local AI model is missing.*Activity tracking continues.*Reinstall the model in AI settings.*Open AI settings/i,
    ],
    [
      "insufficient_memory",
      /This model needs more memory.*Activity tracking continues.*Choose a smaller Local AI model.*Open AI settings/i,
    ],
    [
      "insufficient_storage",
      /Not enough storage for Local AI.*Activity tracking continues.*Free up storage or choose a smaller model.*Open AI settings/i,
    ],
    [
      "runtime_missing",
      /Local AI runtime is missing.*Activity tracking continues.*Reinstall Local AI in AI settings.*Open AI settings/i,
    ],
    [
      "runtime_failed",
      /Local AI couldn’t start.*Activity tracking continues.*Restart Local AI in AI settings.*Open AI settings/i,
    ],
  ] as const)("renders actionable English copy for %s", (errorKind, accessibleName) => {
    const state = resolveSidebarCtaSlot({
      ...baseInput,
      aiStatus: { issueKind: null, label: "Connected", providerLabel: "Qwen 3.5 4B", tone: "ok" },
      billingEntitlement: activeEntitlement,
      managedLocalAiStatus: {
        state: "error",
        selectedModelId: "drifty-qwen3-5-4b-default",
        installedModels: [],
        baseUrl: null,
        model: null,
        message: "Managed local model failed.",
        artifactDir: null,
        progress: null,
        errorKind,
        memoryUsageBytes: null,
      },
    });
    if (!state) throw new Error("Expected managed-local recovery state");

    render(<SidebarCtaSlot state={state} onAction={vi.fn()} />);

    expect(screen.getByRole("button", { name: accessibleName })).toBeTruthy();
  });

  it.each([
    [
      "insufficient_memory",
      8 * 1024 ** 3,
      4 * 1024 ** 3,
      /This model needs 8 GB RAM.*This computer has 4 GB.*Tracking continues.*choose a smaller Local AI model/i,
    ],
    [
      "insufficient_storage",
      6 * 1024 ** 3,
      1.8 * 1024 ** 3,
      /Local AI needs 6 GB free.*1\.8 GB is available.*Tracking continues.*free up space or choose a smaller model/i,
    ],
  ] as const)("renders measured %s recovery values", (errorKind, requiredResourceBytes, availableResourceBytes, accessibleName) => {
    const state = resolveSidebarCtaSlot({
      ...baseInput,
      aiStatus: { issueKind: null, label: "Connected", providerLabel: "Qwen 3.5 4B", tone: "ok" },
      billingEntitlement: activeEntitlement,
      managedLocalAiStatus: {
        state: "error",
        selectedModelId: "drifty-qwen3-5-4b-default",
        installedModels: [],
        baseUrl: null,
        model: null,
        message: "Managed local model failed.",
        artifactDir: null,
        progress: null,
        errorKind,
        memoryUsageBytes: null,
        requiredResourceBytes,
        availableResourceBytes,
      },
    });
    if (!state) throw new Error("Expected measured resource recovery state");

    render(<SidebarCtaSlot state={state} onAction={vi.fn()} />);

    expect(screen.getByRole("button", { name: accessibleName })).toBeTruthy();
  });

  it("renders download progress as passive status with no action button", () => {
    const state = resolveSidebarCtaSlot({
      ...baseInput,
      aiStatus: { issueKind: null, label: "AI setup needed", providerLabel: "Open settings", tone: "error" },
      billingEntitlement: null,
      managedLocalAiStatus: {
        state: "installing",
        selectedModelId: "drifty-qwen3-5-4b-default",
        installedModels: [],
        baseUrl: null,
        model: null,
        message: "Downloading managed local model... (42%)",
        artifactDir: null,
        progress: { percent: 42, downloadedBytes: 1_176_000_000, totalBytes: 2_800_000_000 },
        errorKind: null,
        memoryUsageBytes: null,
      },
    });
    if (!state || state.kind !== "download") throw new Error("Expected download state");

    const { container } = render(<SidebarCtaSlot state={state} onAction={vi.fn()} />);

    const status = screen.getByRole("status", { name: /Downloading model.*Qwen 3\.5 4B.*1\.2\/2\.8 GB.*42%/i });
    expect(status.getAttribute("data-kind")).toBe("download");
    expect(status.style.getPropertyValue("--sidebar-download-progress")).toBe("42%");
    expect(screen.getByRole("progressbar", { name: "Downloading model" }).getAttribute("aria-valuenow")).toBe("42");
    expect(container.querySelector(".sidebar-cta-slot__action")).toBeNull();
    expect(screen.queryByRole("button")).toBeNull();
  });

  it("localizes the complete CTA state instead of only its action", () => {
    render(
      <LocalizationTestProvider language="ko">
        <SidebarCtaSlot
          state={{
            actionLabelKey: "sidebar.cta.upgrade.action",
            alert: "critical",
            copyKey: "sidebar.cta.trial.detail",
            direction: "external",
            disabled: false,
            kind: "trial",
            titleKey: "sidebar.cta.trial.title",
            titleEmphasisCount: 1,
            tone: "trial",
          }}
          onAction={vi.fn()}
        />
      </LocalizationTestProvider>,
    );

    expect(screen.getByRole("button", { name: /무료 체험 종료까지 1일.*Pro로 업그레이드/ })).toBeTruthy();
  });
});
