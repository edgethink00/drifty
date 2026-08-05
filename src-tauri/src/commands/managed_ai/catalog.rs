use serde::Serialize;

const GIB: u64 = 1024 * 1024 * 1024;

#[derive(Clone, Copy)]
pub(super) struct ManagedAiModelSpec {
    pub(super) id: &'static str,
    pub(super) tier: &'static str,
    pub(super) label: &'static str,
    pub(super) detail: &'static str,
    pub(super) download_size: &'static str,
    pub(super) disk_required: &'static str,
    pub(super) disk_required_bytes: u64,
    pub(super) minimum_memory: &'static str,
    pub(super) runtime_model: &'static str,
    pub(super) download_url: &'static str,
    pub(super) file_name: &'static str,
    pub(super) expected_size_bytes: u64,
    pub(super) expected_sha256: &'static str,
    pub(super) estimated_runtime_memory_bytes: u64,
    pub(super) min_memory_bytes: u64,
    pub(super) good_memory_bytes: u64,
    pub(super) recommended: bool,
}

pub(super) const MANAGED_MODELS: &[ManagedAiModelSpec] = &[
    ManagedAiModelSpec {
        id: "drifty-qwen3-5-2b-economy",
        tier: "economy",
        label: "Qwen 3.5 2B",
        detail: "Lightest and fastest, but least accurate — fine for rough sorting on older Macs.",
        download_size: "~1.4 GB",
        disk_required: "3 GB free",
        disk_required_bytes: 3 * GIB,
        minimum_memory: "8 GB RAM",
        runtime_model: "drifty-qwen3.5-2b-local",
        download_url: "https://huggingface.co/unsloth/Qwen3.5-2B-GGUF/resolve/f6d5376be1edb4d416d56da11e5397a961aca8ae/Qwen3.5-2B-Q4_K_M.gguf",
        file_name: "Qwen3.5-2B-Q4_K_M.gguf",
        expected_size_bytes: 1_280_835_840,
        expected_sha256: "aaf42c8b7c3cab2bf3d69c355048d4a0ee9973d48f16c731c0520ee914699223",
        estimated_runtime_memory_bytes: 2_147_483_648,
        min_memory_bytes: 8 * GIB,
        good_memory_bytes: 8 * GIB,
        recommended: false,
    },
    ManagedAiModelSpec {
        id: "drifty-qwen3-5-4b-default",
        tier: "default",
        label: "Qwen 3.5 4B",
        detail: "Best balance of speed and accuracy for most Macs — what we suggest.",
        download_size: "~2.8 GB",
        disk_required: "6 GB free",
        disk_required_bytes: 6 * GIB,
        minimum_memory: "16 GB RAM",
        runtime_model: "drifty-qwen3.5-4b-local",
        download_url: "https://huggingface.co/unsloth/Qwen3.5-4B-GGUF/resolve/e87f176479d0855a907a41277aca2f8ee7a09523/Qwen3.5-4B-Q4_K_M.gguf",
        file_name: "Qwen3.5-4B-Q4_K_M.gguf",
        expected_size_bytes: 2_740_937_888,
        expected_sha256: "00fe7986ff5f6b463e62455821146049db6f9313603938a70800d1fb69ef11a4",
        estimated_runtime_memory_bytes: 3_758_096_384,
        min_memory_bytes: 8 * GIB,
        good_memory_bytes: 16 * GIB,
        recommended: true,
    },
    ManagedAiModelSpec {
        id: "drifty-gemma-4-12b-local",
        tier: "gemma",
        label: "Gemma 4 12B",
        detail: "More accurate on nuanced work, a bit slower and heavier to run.",
        download_size: "~7.2 GB",
        disk_required: "15 GB free",
        disk_required_bytes: 15 * GIB,
        minimum_memory: "16 GB RAM",
        runtime_model: "drifty-gemma4-12b-local",
        download_url: "https://huggingface.co/unsloth/gemma-4-12b-it-GGUF/resolve/fc034cfff751157913579611efad8462ac1be606/gemma-4-12b-it-Q4_K_M.gguf",
        file_name: "gemma-4-12b-it-Q4_K_M.gguf",
        expected_size_bytes: 7_121_861_440,
        expected_sha256: "0a270ec9fe6b34f4a0d33992b6135117b484ebc4766ab76b51d4ae8c457e4c42",
        estimated_runtime_memory_bytes: 9_288_286_208,
        min_memory_bytes: 16 * GIB,
        good_memory_bytes: 32 * GIB,
        recommended: false,
    },
    ManagedAiModelSpec {
        id: "drifty-qwen3-6-27b-smart",
        tier: "smart",
        label: "Qwen 3.6 27B",
        detail: "Most accurate classification — needs a powerful Mac and more memory.",
        download_size: "~16.8 GB",
        disk_required: "30 GB free",
        disk_required_bytes: 30 * GIB,
        minimum_memory: "36 GB RAM",
        runtime_model: "drifty-qwen3.6-27b-local",
        download_url: "https://huggingface.co/unsloth/Qwen3.6-27B-GGUF/resolve/82d411acf4a06cfb8d9b073a5211bf410bfc29bf/Qwen3.6-27B-Q4_K_M.gguf",
        file_name: "Qwen3.6-27B-Q4_K_M.gguf",
        expected_size_bytes: 16_817_244_384,
        expected_sha256: "5ed60d0af4650a854b1755bd392f9aef4872643dc25a254bc68043fa638392a0",
        estimated_runtime_memory_bytes: 19_864_223_744,
        min_memory_bytes: 36 * GIB,
        good_memory_bytes: 48 * GIB,
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
    pub(super) estimated_runtime_memory_bytes: u64,
    pub(super) recommended: bool,
    pub(super) fit: Option<String>,
    pub(super) fit_detail: Option<String>,
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
        estimated_runtime_memory_bytes: spec.estimated_runtime_memory_bytes,
        recommended: spec.recommended,
        fit: None,
        fit_detail: None,
    }
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub(super) enum ManagedAiModelFit {
    Good,
    Tight,
    Insufficient,
}

impl ManagedAiModelFit {
    fn as_str(self) -> &'static str {
        match self {
            ManagedAiModelFit::Good => "good",
            ManagedAiModelFit::Tight => "tight",
            ManagedAiModelFit::Insufficient => "insufficient",
        }
    }
}

pub(super) fn model_fit(spec: ManagedAiModelSpec, machine_memory_bytes: u64) -> ManagedAiModelFit {
    if machine_memory_bytes < spec.min_memory_bytes {
        ManagedAiModelFit::Insufficient
    } else if machine_memory_bytes >= spec.good_memory_bytes {
        ManagedAiModelFit::Good
    } else {
        ManagedAiModelFit::Tight
    }
}

pub(super) fn catalog_model_for_machine(
    spec: ManagedAiModelSpec,
    machine_memory_bytes: Option<u64>,
    recommended_id: Option<&str>,
) -> ManagedAiCatalogModel {
    let mut model = catalog_model(spec);
    let Some(machine) = machine_memory_bytes else {
        return model;
    };
    let fit = model_fit(spec, machine);
    model.fit = Some(fit.as_str().to_string());
    model.fit_detail = fit_detail(spec, fit, machine);
    model.recommended = recommended_id == Some(spec.id);
    model
}

pub(super) fn recommended_model_id(machine_memory_bytes: u64) -> Option<&'static str> {
    const PREFERENCE: &[&str] = &[
        "drifty-qwen3-5-4b-default",
        "drifty-qwen3-5-2b-economy",
        "drifty-gemma-4-12b-local",
        "drifty-qwen3-6-27b-smart",
    ];
    PREFERENCE.iter().copied().find(|id| {
        MANAGED_MODELS.iter().any(|spec| {
            spec.id == *id && model_fit(*spec, machine_memory_bytes) == ManagedAiModelFit::Good
        })
    })
}

fn fit_detail(
    spec: ManagedAiModelSpec,
    fit: ManagedAiModelFit,
    machine_memory_bytes: u64,
) -> Option<String> {
    match fit {
        ManagedAiModelFit::Good => None,
        ManagedAiModelFit::Tight => Some(format!(
            "May be slow and heavy alongside other apps on a {} GB Mac.",
            whole_gigabytes(machine_memory_bytes)
        )),
        ManagedAiModelFit::Insufficient => Some(format!(
            "Needs at least {} GB of memory — this Mac has {} GB.",
            whole_gigabytes(spec.min_memory_bytes),
            whole_gigabytes(machine_memory_bytes)
        )),
    }
}

fn whole_gigabytes(bytes: u64) -> u64 {
    (bytes + GIB / 2) / GIB
}
