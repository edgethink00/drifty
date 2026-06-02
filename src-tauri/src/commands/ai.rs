use std::time::Instant;

use serde::{Deserialize, Serialize};

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AiClassificationChatRequest {
    pub base_url: String,
    pub api_key: Option<String>,
    pub model: String,
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
    let model = request.model.trim();
    if model.is_empty() {
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

    if let Some(api_key) = request.api_key.as_deref().map(str::trim).filter(|value| !value.is_empty()) {
        builder = builder.bearer_auth(api_key);
    }

    for (name, value) in request.headers {
        if let Some(header_value) = value.as_str().map(str::trim).filter(|value| !value.is_empty()) {
            builder = builder.header(name, header_value);
        }
    }

    let started_at = Instant::now();
    let response = builder
        .json(&serde_json::json!({
            "model": model,
            "messages": request.messages,
            "temperature": 0.1,
            "stream": false,
        }))
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
            stream.write_all(response.as_bytes()).expect("write response");
            request
        });

        let response = post_openai_chat(AiClassificationChatRequest {
            base_url: format!("http://{}", address),
            api_key: Some("router-key".to_string()),
            model: "openrouter/auto".to_string(),
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
        assert!(request.contains("\"model\":\"openrouter/auto\""));
        assert!(request.contains("\"stream\":false"));
    }
}
