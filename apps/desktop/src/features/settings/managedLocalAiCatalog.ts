export type ManagedLocalAiModel = {
  readonly id: string;
  readonly tier: "economy" | "default" | "gemma" | "smart";
  readonly label: string;
  readonly detail: string;
  readonly downloadSize: string;
  readonly diskRequired: string;
  readonly minimumMemory: string;
  readonly recommended: boolean;
};

export const MANAGED_LOCAL_AI_FALLBACK_CATALOG = [
  {
    id: "drifty-qwen3-5-2b-economy",
    tier: "economy",
    label: "Qwen 3.5 2B",
    detail: "Small managed local model for quick classification checks.",
    downloadSize: "~1.4 GB",
    diskRequired: "3 GB free",
    minimumMemory: "8 GB RAM",
    recommended: false,
  },
  {
    id: "drifty-qwen3-5-4b-default",
    tier: "default",
    label: "Qwen 3.5 4B",
    detail: "Recommended balance for on-device Drifty classification.",
    downloadSize: "~2.8 GB",
    diskRequired: "6 GB free",
    minimumMemory: "16 GB RAM",
    recommended: true,
  },
  {
    id: "drifty-gemma-4-12b-local",
    tier: "gemma",
    label: "Gemma 4 12B",
    detail: "Current Gemma 4 12B option for private local classification.",
    downloadSize: "~7.2 GB",
    diskRequired: "15 GB free",
    minimumMemory: "16 GB RAM",
    recommended: false,
  },
  {
    id: "drifty-qwen3-6-27b-smart",
    tier: "smart",
    label: "Qwen 3.6 27B",
    detail: "Smaller Qwen 3.6 option for stronger local reasoning.",
    downloadSize: "~15 GB",
    diskRequired: "30 GB free",
    minimumMemory: "36 GB RAM",
    recommended: false,
  },
] satisfies readonly ManagedLocalAiModel[];
