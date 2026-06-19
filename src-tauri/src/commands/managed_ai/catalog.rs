use serde::Serialize;

#[derive(Clone, Copy)]
pub(super) struct ManagedAiModelSpec {
    pub(super) id: &'static str,
    pub(super) tier: &'static str,
    pub(super) label: &'static str,
    pub(super) detail: &'static str,
    pub(super) download_size: &'static str,
    pub(super) disk_required: &'static str,
    pub(super) minimum_memory: &'static str,
    pub(super) runtime_model: &'static str,
    pub(super) download_url: &'static str,
    pub(super) file_name: &'static str,
    pub(super) expected_size_bytes: u64,
    pub(super) recommended: bool,
}

pub(super) const MANAGED_MODELS: &[ManagedAiModelSpec] = &[
    ManagedAiModelSpec {
        id: "drifty-qwen3-5-2b-economy",
        tier: "economy",
        label: "Qwen 3.5 2B",
        detail: "Small managed local model for quick classification checks.",
        download_size: "~1.4 GB",
        disk_required: "3 GB free",
        minimum_memory: "8 GB RAM",
        runtime_model: "drifty-qwen3.5-2b-local",
        download_url: "https://huggingface.co/unsloth/Qwen3.5-2B-GGUF/resolve/main/Qwen3.5-2B-Q4_K_M.gguf",
        file_name: "Qwen3.5-2B-Q4_K_M.gguf",
        expected_size_bytes: 1_280_835_840,
        recommended: false,
    },
    ManagedAiModelSpec {
        id: "drifty-qwen3-5-4b-default",
        tier: "default",
        label: "Qwen 3.5 4B",
        detail: "Recommended balance for on-device Drifty classification.",
        download_size: "~2.8 GB",
        disk_required: "6 GB free",
        minimum_memory: "16 GB RAM",
        runtime_model: "drifty-qwen3.5-4b-local",
        download_url: "https://huggingface.co/unsloth/Qwen3.5-4B-GGUF/resolve/main/Qwen3.5-4B-Q4_K_M.gguf",
        file_name: "Qwen3.5-4B-Q4_K_M.gguf",
        expected_size_bytes: 2_740_937_888,
        recommended: true,
    },
    ManagedAiModelSpec {
        id: "drifty-gemma-4-12b-local",
        tier: "gemma",
        label: "Gemma 4 12B",
        detail: "Current Gemma 4 12B option for private local classification.",
        download_size: "~7.2 GB",
        disk_required: "15 GB free",
        minimum_memory: "16 GB RAM",
        runtime_model: "drifty-gemma4-12b-local",
        download_url: "https://huggingface.co/unsloth/gemma-4-12b-it-GGUF/resolve/main/gemma-4-12b-it-Q4_K_M.gguf",
        file_name: "gemma-4-12b-it-Q4_K_M.gguf",
        expected_size_bytes: 7_121_860_000,
        recommended: false,
    },
    ManagedAiModelSpec {
        id: "drifty-qwen3-6-27b-smart",
        tier: "smart",
        label: "Qwen 3.6 27B",
        detail: "Smaller Qwen 3.6 option for stronger local reasoning.",
        download_size: "~15 GB",
        disk_required: "30 GB free",
        minimum_memory: "36 GB RAM",
        runtime_model: "drifty-qwen3.6-27b-local",
        download_url: "https://huggingface.co/unsloth/Qwen3.6-27B-GGUF/resolve/main/Qwen3.6-27B-Q4_K_M.gguf",
        file_name: "Qwen3.6-27B-Q4_K_M.gguf",
        expected_size_bytes: 16_817_244_384,
        recommended: false,
    },
];

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ManagedAiCatalogModel {
    pub(super) id: String,
    pub(super) tier: String,
    pub(super) label: String,
    pub(super) detail: String,
    pub(super) download_size: String,
    pub(super) disk_required: String,
    pub(super) minimum_memory: String,
    pub(super) recommended: bool,
}

pub(super) fn catalog_model(spec: ManagedAiModelSpec) -> ManagedAiCatalogModel {
    ManagedAiCatalogModel {
        id: spec.id.to_string(),
        tier: spec.tier.to_string(),
        label: spec.label.to_string(),
        detail: spec.detail.to_string(),
        download_size: spec.download_size.to_string(),
        disk_required: spec.disk_required.to_string(),
        minimum_memory: spec.minimum_memory.to_string(),
        recommended: spec.recommended,
    }
}
