use std::time::{Duration, Instant};

use serde::{Deserialize, Serialize};
use serde_json::json;

const DEFAULT_CHAT_TIMEOUT: Duration = Duration::from_secs(60);

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
    pub reasoning_format: Option<String>,
    #[serde(default)]
    pub chat_template_kwargs: serde_json::Map<String, serde_json::Value>,
    #[serde(default)]
    pub headers: serde_json::Map<String, serde_json::Value>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AiClassificationChatResponse {
    pub status: u16,
    pub body: String,
    pub latency_ms: u128,
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

    let response = builder
        .json(&body)
        .send()
        .map_err(|error| error.to_string())?;
    let status = response.status().as_u16();
    let body = response.text().map_err(|error| error.to_string())?;

    Ok(AiClassificationChatResponse {
        status,
        body,
        latency_ms: started_at.elapsed().as_millis(),
    })
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
