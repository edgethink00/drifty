export type ManagedLocalAiModel = {
  readonly id: string;
  readonly tier: "economy" | "default" | "gemma" | "smart";
  readonly label: string;
  readonly detail: string;
  readonly downloadSize: string;
  readonly diskRequired: string;
  readonly minimumMemory: string;
  readonly estimatedRuntimeMemoryBytes: number | null;
  readonly recommended: boolean;
};

export const MANAGED_LOCAL_AI_FALLBACK_CATALOG = [
  {
    id: "drifty-qwen3-5-2b-economy",
    tier: "economy",
    label: "Qwen 3.5 2B",
    detail: "Lightest and fastest, but least accurate — fine for rough sorting on older Macs.",
    downloadSize: "~1.4 GB",
    diskRequired: "3 GB free",
    minimumMemory: "8 GB RAM",
    estimatedRuntimeMemoryBytes: 2_147_483_648,
    recommended: false,
  },
  {
    id: "drifty-qwen3-5-4b-default",
    tier: "default",
    label: "Qwen 3.5 4B",
    detail: "Best balance of speed and accuracy for most Macs — what we suggest.",
    downloadSize: "~2.8 GB",
    diskRequired: "6 GB free",
    minimumMemory: "16 GB RAM",
    estimatedRuntimeMemoryBytes: 3_758_096_384,
    recommended: true,
  },
  {
    id: "drifty-gemma-4-12b-local",
    tier: "gemma",
    label: "Gemma 4 12B",
    detail: "More accurate on nuanced work, a bit slower and heavier to run.",
    downloadSize: "~7.2 GB",
    diskRequired: "15 GB free",
    minimumMemory: "16 GB RAM",
    estimatedRuntimeMemoryBytes: 9_288_286_208,
    recommended: false,
  },
  {
    id: "drifty-qwen3-6-27b-smart",
    tier: "smart",
    label: "Qwen 3.6 27B",
    detail: "Most accurate classification — needs a powerful Mac and more memory.",
    downloadSize: "~15 GB",
    diskRequired: "30 GB free",
    minimumMemory: "36 GB RAM",
    estimatedRuntimeMemoryBytes: 19_864_223_744,
    recommended: false,
  },
] satisfies readonly ManagedLocalAiModel[];
