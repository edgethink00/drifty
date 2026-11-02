use std::io::Read;
use std::time::{Duration, Instant};

use reqwest::blocking::{Client, RequestBuilder};
use serde_json::json;

use super::super::managed_ai::{MANAGED_BASE_URL, MANAGED_CONTEXT_TOKENS};
use super::AiClassificationChatResponse;

const TOKEN_CHECK_TIMEOUT: Duration = Duration::from_secs(10);
const MAX_TOKEN_RESPONSE_BYTES: u64 = 64 * 1024;

pub(super) fn context_limit_for_base(base_url: &str) -> Option<u32> {
    // Other OpenAI-compatible providers need not implement this llama.cpp API.
    (base_url.trim().trim_end_matches('/') == MANAGED_BASE_URL).then_some(MANAGED_CONTEXT_TOKENS)
}

pub(super) fn check_context_budget(
    client: &Client,
    generation: &RequestBuilder,
    output_tokens: Option<u32>,
    context_tokens: u32,
    started_at: Instant,
    timeout: Duration,
) -> Result<Option<AiClassificationChatResponse>, String> {
    let output_tokens = output_tokens
        .filter(|tokens| *tokens > 0)
        .ok_or("Managed local AI requests require a positive output token budget.")?;
    let remaining = timeout.saturating_sub(started_at.elapsed());
    if remaining.is_zero() {
        return Err("Managed local AI token check timed out.".to_string());
    }
    // Clone the serialized generation request, including template options and
    // response format. Counting just message text misses the actual template.
    let mut request = generation
        .try_clone()
        .ok_or("Managed local AI token check could not copy the request.")?
        .timeout(remaining.min(TOKEN_CHECK_TIMEOUT))
        .build()
        .map_err(|_| "Managed local AI token check could not build the request.")?;
    let path = format!("{}/input_tokens", request.url().path());
    request.url_mut().set_path(&path);
    let mut response = client
        .execute(request)
        .map_err(|_| "Managed local AI token check failed before generation.")?;
    if !response.status().is_success() {
        return Err("Managed local AI token check was rejected before generation.".to_string());
    }
    if response
        .content_length()
        .is_some_and(|size| size > MAX_TOKEN_RESPONSE_BYTES)
    {
        return Err("Managed local AI token check response exceeded its size limit.".to_string());
    }
    let mut bytes = Vec::new();
    response
        .by_ref()
        .take(MAX_TOKEN_RESPONSE_BYTES + 1)
        .read_to_end(&mut bytes)
        .map_err(|_| "Managed local AI token check response could not be read.")?;
    if bytes.len() as u64 > MAX_TOKEN_RESPONSE_BYTES {
        return Err("Managed local AI token check response exceeded its size limit.".to_string());
    }
    let counted: serde_json::Value = serde_json::from_slice(&bytes)
        .map_err(|_| "Managed local AI token check returned an invalid response.")?;
    let input_tokens = counted["input_tokens"]
        .as_u64()
        .filter(|tokens| *tokens > 0)
        .ok_or("Managed local AI token check returned an invalid token count.")?;
    let context_tokens = u64::from(context_tokens);
    if input_tokens <= context_tokens && u64::from(output_tokens) <= context_tokens - input_tokens {
        return Ok(None);
    }
    Ok(Some(AiClassificationChatResponse {
        status: 400,
        body: json!({"error": {
            "code": "drifty_context_budget_exceeded",
            "type": "context_length_exceeded",
            "message": format!("Managed local AI context limit exceeded: input {input_tokens}, output budget {output_tokens}, limit {context_tokens} tokens."),
        }})
        .to_string(),
        latency_ms: started_at.elapsed().as_millis(),
        retry_after_ms: None,
    }))
}
