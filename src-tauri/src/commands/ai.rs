use std::io::Read;
use std::time::{Duration, Instant};

use serde::{Deserialize, Serialize};
use serde_json::json;

const DEFAULT_CHAT_TIMEOUT: Duration = Duration::from_secs(60);
/// Reaching a provider takes well under a second even on a slow link. Without
/// this, an address that never answers holds a request, and the onboarding or
/// settings connection test, for the whole chat timeout. Generation time is
/// still bounded only by the chat timeout, so slow local models are unaffected.
const CHAT_CONNECT_TIMEOUT: Duration = Duration::from_secs(10);
const DEFAULT_MODEL_LIST_TIMEOUT: Duration = Duration::from_secs(15);
const MAX_MODEL_LIST_RESPONSE_BYTES: u64 = 5_000_000;

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AiClassificationChatRequest {
    pub base_url: String,
    pub api_key: Option<String>,
    pub model: Option<String>,
    pub models: Option<Vec<String>>,
    pub messages: Vec<serde_json::Value>,
    pub max_tokens: Option<u32>,
    pub timeout_ms: Option<u64>,
    pub temperature: Option<f64>,
    pub response_format: Option<serde_json::Value>,
    pub reasoning_format: Option<String>,
    #[serde(default)]
    pub chat_template_kwargs: serde_json::Map<String, serde_json::Value>,
    #[serde(default)]
    pub provider: serde_json::Map<String, serde_json::Value>,
    #[serde(default)]
    pub headers: serde_json::Map<String, serde_json::Value>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AiClassificationChatResponse {
    pub status: u16,
    pub body: String,
    pub latency_ms: u128,
    pub retry_after_ms: Option<u64>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AiModelListRequest {
    pub base_url: String,
    pub api_key: Option<String>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AiModelListResponse {
    pub status: u16,
    pub body: String,
}

#[tauri::command]
pub async fn ai_list_openai_models(
    request: AiModelListRequest,
) -> Result<AiModelListResponse, String> {
    tauri::async_runtime::spawn_blocking(move || get_openai_models(request))
        .await
        .map_err(|error| error.to_string())?
}

pub fn get_openai_models(request: AiModelListRequest) -> Result<AiModelListResponse, String> {
    let base_url = request.base_url.trim().trim_end_matches('/');
    if base_url.is_empty() {
        return Err("AI provider base URL is required.".to_string());
    }

    let client = reqwest::blocking::Client::builder()
        .timeout(DEFAULT_MODEL_LIST_TIMEOUT)
        .build()
        .map_err(|error| error.to_string())?;
    let mut builder = client.get(format!("{base_url}/models"));
    if let Some(api_key) = request
        .api_key
        .as_deref()
        .map(str::trim)
        .filter(|value| !value.is_empty())
    {
        builder = builder.bearer_auth(api_key);
    }

    let mut response = builder.send().map_err(|error| error.to_string())?;
    let status = response.status().as_u16();
    if response
        .content_length()
        .is_some_and(|length| length > MAX_MODEL_LIST_RESPONSE_BYTES)
    {
        return Err("AI provider model list response exceeded the 5 MB limit.".to_string());
    }
    let mut body_bytes = Vec::new();
    response
        .by_ref()
        .take(MAX_MODEL_LIST_RESPONSE_BYTES + 1)
        .read_to_end(&mut body_bytes)
        .map_err(|error| error.to_string())?;
    if body_bytes.len() as u64 > MAX_MODEL_LIST_RESPONSE_BYTES {
        return Err("AI provider model list response exceeded the 5 MB limit.".to_string());
    }
    let body = String::from_utf8(body_bytes)
        .map_err(|_| "AI provider model list response was not valid UTF-8.".to_string())?;
    Ok(AiModelListResponse { status, body })
}

#[tauri::command]
pub async fn ai_classification_openai_chat(
    request: AiClassificationChatRequest,
) -> Result<AiClassificationChatResponse, String> {
    tauri::async_runtime::spawn_blocking(move || post_openai_chat(request))
        .await
        .map_err(|error| error.to_string())?
}

pub fn post_openai_chat(
    request: AiClassificationChatRequest,
) -> Result<AiClassificationChatResponse, String> {
    let base_url = request.base_url.trim().trim_end_matches('/');
    if base_url.is_empty() {
        return Err("AI provider base URL is required.".to_string());
    }
    let models = normalize_models(request.model.as_deref(), request.models.as_deref());
    if models.is_empty() {
        return Err("AI provider model is required.".to_string());
    }

    let url = format!("{base_url}/chat/completions");
    let timeout = request
        .timeout_ms
        .filter(|value| *value > 0)
        .map(Duration::from_millis)
        .unwrap_or(DEFAULT_CHAT_TIMEOUT);
    let client = reqwest::blocking::Client::builder()
        .connect_timeout(CHAT_CONNECT_TIMEOUT)
        .timeout(timeout)
        .build()
        .map_err(|error| error.to_string())?;

    let mut builder = client
        .post(url)
        .header(reqwest::header::CONTENT_TYPE, "application/json");

    if let Some(api_key) = request
        .api_key
        .as_deref()
        .map(str::trim)
        .filter(|value| !value.is_empty())
    {
        builder = builder.bearer_auth(api_key);
    }

    for (name, value) in request.headers {
        if let Some(header_value) = value
            .as_str()
            .map(str::trim)
            .filter(|value| !value.is_empty())
        {
            builder = builder.header(name, header_value);
        }
    }

    let started_at = Instant::now();
    let mut body = serde_json::Map::from_iter([
        ("messages".to_string(), json!(request.messages)),
        (
            "temperature".to_string(),
            json!(request.temperature.unwrap_or(0.1)),
        ),
        ("stream".to_string(), json!(false)),
    ]);
    if models.len() == 1 {
        body.insert("model".to_string(), json!(models[0]));
    } else {
        body.insert("models".to_string(), json!(models));
    }
    if let Some(max_tokens) = request.max_tokens.filter(|value| *value > 0) {
        body.insert("max_tokens".to_string(), json!(max_tokens));
    }
    if let Some(response_format) = request.response_format {
        body.insert("response_format".to_string(), response_format);
    }
    if let Some(reasoning_format) = request
        .reasoning_format
        .as_deref()
        .map(str::trim)
        .filter(|value| !value.is_empty())
    {
        body.insert("reasoning_format".to_string(), json!(reasoning_format));
    }
    if !request.chat_template_kwargs.is_empty() {
        body.insert(
            "chat_template_kwargs".to_string(),
            serde_json::Value::Object(request.chat_template_kwargs),
        );
    }
    if !request.provider.is_empty() {
        body.insert(
            "provider".to_string(),
            serde_json::Value::Object(request.provider),
        );
    }

    let response = builder
        .json(&body)
        .send()
        .map_err(|error| error.to_string())?;
    let status = response.status().as_u16();
    let retry_after_ms = retry_after_ms(response.headers());
    let body = response.text().map_err(|error| error.to_string())?;

    Ok(AiClassificationChatResponse {
        status,
        body,
        latency_ms: started_at.elapsed().as_millis(),
        retry_after_ms,
    })
}

const ANTHROPIC_DEFAULT_BASE_URL: &str = "https://api.anthropic.com/v1";
const ANTHROPIC_DEFAULT_VERSION: &str = "2023-06-01";
const ANTHROPIC_DEFAULT_MAX_TOKENS: u32 = 4096;

/// Anthropic's Messages API is not OpenAI-shaped: it authenticates with an
/// `x-api-key` header + `anthropic-version`, and its body/response differ
/// (`content[0].text`, `usage.input_tokens/output_tokens`). This command mirrors
/// `ai_classification_openai_chat`'s structure/error handling but posts to
/// `/messages`. The raw response `body` is returned as a JSON string (reqwest
/// `text()`); the TS side maps Anthropic's shape onto the internal result.
#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AiClassificationAnthropicChatRequest {
    /// Overridable so tests can target a local server; defaults to Anthropic.
    #[serde(default)]
    pub base_url: Option<String>,
    pub api_key: String,
    pub model: String,
    pub messages: Vec<serde_json::Value>,
    pub max_tokens: Option<u32>,
    pub timeout_ms: Option<u64>,
    pub temperature: Option<f64>,
    pub anthropic_version: Option<String>,
}

#[tauri::command]
pub async fn ai_classification_anthropic_chat(
    request: AiClassificationAnthropicChatRequest,
) -> Result<AiClassificationChatResponse, String> {
    tauri::async_runtime::spawn_blocking(move || post_anthropic_chat(request))
        .await
        .map_err(|error| error.to_string())?
}

pub fn post_anthropic_chat(
    request: AiClassificationAnthropicChatRequest,
) -> Result<AiClassificationChatResponse, String> {
    let api_key = request.api_key.trim();
    if api_key.is_empty() {
        return Err("Anthropic API key is required.".to_string());
    }
    let model = request.model.trim();
    if model.is_empty() {
        return Err("Anthropic model is required.".to_string());
    }

    let base_url = request
        .base_url
        .as_deref()
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .unwrap_or(ANTHROPIC_DEFAULT_BASE_URL)
        .trim_end_matches('/');
    let url = format!("{base_url}/messages");

    let timeout = request
        .timeout_ms
        .filter(|value| *value > 0)
        .map(Duration::from_millis)
        .unwrap_or(DEFAULT_CHAT_TIMEOUT);
    let client = reqwest::blocking::Client::builder()
        .connect_timeout(CHAT_CONNECT_TIMEOUT)
        .timeout(timeout)
        .build()
        .map_err(|error| error.to_string())?;

    let anthropic_version = request
        .anthropic_version
        .as_deref()
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .unwrap_or(ANTHROPIC_DEFAULT_VERSION);
    let max_tokens = request
        .max_tokens
        .filter(|value| *value > 0)
        .unwrap_or(ANTHROPIC_DEFAULT_MAX_TOKENS);

    let mut body = serde_json::Map::from_iter([
        ("model".to_string(), json!(model)),
        ("max_tokens".to_string(), json!(max_tokens)),
        ("messages".to_string(), json!(request.messages)),
    ]);
    if let Some(temperature) = request.temperature {
        body.insert("temperature".to_string(), json!(temperature));
    }

    let started_at = Instant::now();
    let response = client
        .post(url)
        .header(reqwest::header::CONTENT_TYPE, "application/json")
        .header("x-api-key", api_key)
        .header("anthropic-version", anthropic_version)
        .json(&body)
        .send()
        .map_err(|error| error.to_string())?;
    let status = response.status().as_u16();
    let retry_after_ms = retry_after_ms(response.headers());
    let body = response.text().map_err(|error| error.to_string())?;

    Ok(AiClassificationChatResponse {
        status,
        body,
        latency_ms: started_at.elapsed().as_millis(),
        retry_after_ms,
    })
}

fn retry_after_ms(headers: &reqwest::header::HeaderMap) -> Option<u64> {
    const MAX_RETRY_AFTER_SECONDS: u64 = 24 * 60 * 60;
    let seconds = headers
        .get(reqwest::header::RETRY_AFTER)?
        .to_str()
        .ok()?
        .trim()
        .parse::<u64>()
        .ok()?
        .min(MAX_RETRY_AFTER_SECONDS);
    seconds.checked_mul(1000)
}

fn normalize_models(model: Option<&str>, models: Option<&[String]>) -> Vec<String> {
    let source_models: Vec<&str> = if let Some(models) = models {
        models.iter().map(String::as_str).collect()
    } else {
        model.into_iter().collect()
    };
    let mut seen = std::collections::HashSet::new();
    let mut normalized = Vec::new();

    for value in source_models {
        let trimmed = value.trim();
        if trimmed.is_empty() || !seen.insert(trimmed.to_string()) {
            continue;
        }
        normalized.push(trimmed.to_string());
    }

    normalized
}

#[cfg(test)]
mod tests;
