use std::time::Instant;

use serde::{Deserialize, Serialize};
use serde_json::json;

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AiClassificationChatRequest {
    pub base_url: String,
    pub api_key: Option<String>,
    pub model: Option<String>,
    pub models: Option<Vec<String>>,
    pub messages: Vec<serde_json::Value>,
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
    let client = reqwest::blocking::Client::builder()
        .timeout(std::time::Duration::from_secs(60))
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
        ("temperature".to_string(), json!(0.1)),
        ("stream".to_string(), json!(false)),
    ]);
    if models.len() == 1 {
        body.insert("model".to_string(), json!(models[0]));
    } else {
        body.insert("models".to_string(), json!(models));
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
mod tests {
    use std::io::{Read, Write};
    use std::net::TcpListener;
    use std::thread;

    use serde_json::json;

    use super::{post_openai_chat, AiClassificationChatRequest};

    #[test]
    fn posts_openai_compatible_chat_body_with_headers() {
        let listener = TcpListener::bind("127.0.0.1:0").expect("bind test server");
        let address = listener.local_addr().expect("read test server address");
        let server = thread::spawn(move || {
            let (mut stream, _) = listener.accept().expect("accept request");
            let mut buffer = [0_u8; 8192];
            let bytes = stream.read(&mut buffer).expect("read request");
            let request = String::from_utf8_lossy(&buffer[..bytes]).to_string();
            let body = r#"{"choices":[{"message":{"content":"{\"results\":[]}"}}]}"#;
            let response = format!(
                "HTTP/1.1 200 OK\r\nContent-Type: application/json\r\nContent-Length: {}\r\n\r\n{}",
                body.len(),
                body
            );
            stream
                .write_all(response.as_bytes())
                .expect("write response");
            request
        });

        let response = post_openai_chat(AiClassificationChatRequest {
            base_url: format!("http://{}", address),
            api_key: Some("router-key".to_string()),
            model: Some("qwen/qwen3.6-flash".to_string()),
            models: None,
            messages: vec![json!({ "role": "user", "content": "classify" })],
            headers: serde_json::Map::from_iter([
                ("HTTP-Referer".to_string(), json!("https://drifty.so")),
                ("X-OpenRouter-Title".to_string(), json!("Drifty")),
            ]),
        })
        .expect("chat request succeeds");

        let request = server.join().expect("join server");
        assert_eq!(response.status, 200);
        assert!(request.starts_with("POST /chat/completions HTTP/1.1"));
        assert!(request.contains("authorization: Bearer router-key"));
        assert!(request.contains("http-referer: https://drifty.so"));
        assert!(request.contains("x-openrouter-title: Drifty"));
        assert!(request.contains('"'.to_string().as_str()));
        assert!(request.contains("\"model\":\"qwen/qwen3.6-flash\""));
        assert!(!request.contains("\"models\""));
        assert!(request.contains("\"stream\":false"));
    }

    #[test]
    fn posts_openrouter_models_array_without_comma_joining() {
        let listener = TcpListener::bind("127.0.0.1:0").expect("bind test server");
        let address = listener.local_addr().expect("read test server address");
        let server = thread::spawn(move || {
            let (mut stream, _) = listener.accept().expect("accept request");
            let mut buffer = [0_u8; 8192];
            let bytes = stream.read(&mut buffer).expect("read request");
            let request = String::from_utf8_lossy(&buffer[..bytes]).to_string();
            let body = r#"{"choices":[{"message":{"content":"{\"results\":[]}"}}]}"#;
            let response = format!(
                "HTTP/1.1 200 OK\r\nContent-Type: application/json\r\nContent-Length: {}\r\n\r\n{}",
                body.len(),
                body
            );
            stream
                .write_all(response.as_bytes())
                .expect("write response");
            request
        });

        post_openai_chat(AiClassificationChatRequest {
            base_url: format!("http://{}", address),
            api_key: Some("router-key".to_string()),
            model: None,
            models: Some(vec![
                "openai/gpt-4o-mini".to_string(),
                "anthropic/claude-3.5-haiku".to_string(),
            ]),
            messages: vec![json!({ "role": "user", "content": "classify" })],
            headers: serde_json::Map::new(),
        })
        .expect("chat request succeeds");

        let request = server.join().expect("join server");
        let body = request_body_json(&request);
        assert_eq!(
            body.get("models"),
            Some(&json!(["openai/gpt-4o-mini", "anthropic/claude-3.5-haiku"]))
        );
        assert!(body.get("model").is_none());
    }

    #[test]
    fn posts_single_normalized_models_entry_as_model() {
        let listener = TcpListener::bind("127.0.0.1:0").expect("bind test server");
        let address = listener.local_addr().expect("read test server address");
        let server = thread::spawn(move || {
            let (mut stream, _) = listener.accept().expect("accept request");
            let mut buffer = [0_u8; 8192];
            let bytes = stream.read(&mut buffer).expect("read request");
            let request = String::from_utf8_lossy(&buffer[..bytes]).to_string();
            let body = r#"{"choices":[{"message":{"content":"{\"results\":[]}"}}]}"#;
            let response = format!(
                "HTTP/1.1 200 OK\r\nContent-Type: application/json\r\nContent-Length: {}\r\n\r\n{}",
                body.len(),
                body
            );
            stream
                .write_all(response.as_bytes())
                .expect("write response");
            request
        });

        post_openai_chat(AiClassificationChatRequest {
            base_url: format!("http://{}", address),
            api_key: Some("router-key".to_string()),
            model: None,
            models: Some(vec![" openai/gpt-4o-mini ".to_string()]),
            messages: vec![json!({ "role": "user", "content": "classify" })],
            headers: serde_json::Map::new(),
        })
        .expect("chat request succeeds");

        let request = server.join().expect("join server");
        let body = request_body_json(&request);
        assert_eq!(body.get("model"), Some(&json!("openai/gpt-4o-mini")));
        assert!(body.get("models").is_none());
    }

    #[test]
    fn trims_blank_and_duplicate_models_before_posting() {
        let listener = TcpListener::bind("127.0.0.1:0").expect("bind test server");
        let address = listener.local_addr().expect("read test server address");
        let server = thread::spawn(move || {
            let (mut stream, _) = listener.accept().expect("accept request");
            let mut buffer = [0_u8; 8192];
            let bytes = stream.read(&mut buffer).expect("read request");
            let request = String::from_utf8_lossy(&buffer[..bytes]).to_string();
            let body = r#"{"choices":[{"message":{"content":"{\"results\":[]}"}}]}"#;
            let response = format!(
                "HTTP/1.1 200 OK\r\nContent-Type: application/json\r\nContent-Length: {}\r\n\r\n{}",
                body.len(),
                body
            );
            stream
                .write_all(response.as_bytes())
                .expect("write response");
            request
        });

        post_openai_chat(AiClassificationChatRequest {
            base_url: format!("http://{}", address),
            api_key: Some("router-key".to_string()),
            model: None,
            models: Some(vec![
                " ".to_string(),
                " openai/gpt-4o-mini ".to_string(),
                "openai/gpt-4o-mini".to_string(),
                "anthropic/claude-3.5-haiku".to_string(),
            ]),
            messages: vec![json!({ "role": "user", "content": "classify" })],
            headers: serde_json::Map::new(),
        })
        .expect("chat request succeeds");

        let request = server.join().expect("join server");
        let body = request_body_json(&request);
        assert_eq!(
            body.get("models"),
            Some(&json!(["openai/gpt-4o-mini", "anthropic/claude-3.5-haiku"]))
        );
    }

    #[test]
    fn rejects_requests_without_any_non_empty_model() {
        let error = post_openai_chat(AiClassificationChatRequest {
            base_url: "http://127.0.0.1:9".to_string(),
            api_key: None,
            model: Some(" ".to_string()),
            models: None,
            messages: vec![json!({ "role": "user", "content": "classify" })],
            headers: serde_json::Map::new(),
        })
        .expect_err("blank single model is rejected");

        assert_eq!(error, "AI provider model is required.");

        let error = post_openai_chat(AiClassificationChatRequest {
            base_url: "http://127.0.0.1:9".to_string(),
            api_key: None,
            model: None,
            models: Some(vec!["".to_string(), "  ".to_string()]),
            messages: vec![json!({ "role": "user", "content": "classify" })],
            headers: serde_json::Map::new(),
        })
        .expect_err("blank models array is rejected");

        assert_eq!(error, "AI provider model is required.");
    }

    fn request_body_json(request: &str) -> serde_json::Value {
        let body = request.split("\r\n\r\n").nth(1).expect("request body");
        serde_json::from_str(body).expect("request body json")
    }
}
