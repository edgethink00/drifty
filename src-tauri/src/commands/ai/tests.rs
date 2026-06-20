use std::io::{Read, Write};
use std::net::TcpListener;
use std::thread;

use serde_json::json;

use super::{post_openai_chat, AiClassificationChatRequest};

#[test]
fn posts_openai_compatible_chat_body_with_headers() {
    let (address, server) = capture_one_chat_request();
    let mut request = chat_request(format!("http://{address}"));
    request.api_key = Some("router-key".to_string());
    request.model = Some("qwen/qwen3.6-flash".to_string());
    request.headers = serde_json::Map::from_iter([
        ("HTTP-Referer".to_string(), json!("https://drifty.so")),
        ("X-OpenRouter-Title".to_string(), json!("Drifty")),
    ]);

    let response = post_openai_chat(request).expect("chat request succeeds");

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
    let (address, server) = capture_one_chat_request();
    let mut request = chat_request(format!("http://{address}"));
    request.api_key = Some("router-key".to_string());
    request.model = None;
    request.models = Some(vec![
        "openai/gpt-4o-mini".to_string(),
        "anthropic/claude-3.5-haiku".to_string(),
    ]);

    post_openai_chat(request).expect("chat request succeeds");

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
    let (address, server) = capture_one_chat_request();
    let mut request = chat_request(format!("http://{address}"));
    request.api_key = Some("router-key".to_string());
    request.model = None;
    request.models = Some(vec![" openai/gpt-4o-mini ".to_string()]);

    post_openai_chat(request).expect("chat request succeeds");

    let request = server.join().expect("join server");
    let body = request_body_json(&request);
    assert_eq!(body.get("model"), Some(&json!("openai/gpt-4o-mini")));
    assert!(body.get("models").is_none());
}

#[test]
fn trims_blank_and_duplicate_models_before_posting() {
    let (address, server) = capture_one_chat_request();
    let mut request = chat_request(format!("http://{address}"));
    request.model = None;
    request.models = Some(vec![
        " ".to_string(),
        " openai/gpt-4o-mini ".to_string(),
        "openai/gpt-4o-mini".to_string(),
        "anthropic/claude-3.5-haiku".to_string(),
    ]);

    post_openai_chat(request).expect("chat request succeeds");

    let request = server.join().expect("join server");
    let body = request_body_json(&request);
    assert_eq!(
        body.get("models"),
        Some(&json!(["openai/gpt-4o-mini", "anthropic/claude-3.5-haiku"]))
    );
}

#[test]
fn posts_optional_generation_controls_for_managed_local_runtime() {
    let (address, server) = capture_one_chat_request();
    let mut request = chat_request(format!("http://{address}"));
    request.max_tokens = Some(96);
    request.temperature = Some(0.2);
    request.chat_template_kwargs =
        serde_json::Map::from_iter([("enable_thinking".to_string(), json!(false))]);
    request.reasoning_format = Some("none".to_string());

    post_openai_chat(request).expect("chat request succeeds");

    let request = server.join().expect("join server");
    let body = request_body_json(&request);
    assert_eq!(body.get("max_tokens"), Some(&json!(96)));
    assert_eq!(body.get("temperature"), Some(&json!(0.2)));
    assert_eq!(
        body.get("chat_template_kwargs"),
        Some(&json!({ "enable_thinking": false }))
    );
    assert_eq!(body.get("reasoning_format"), Some(&json!("none")));
}

#[test]
fn rejects_requests_without_any_non_empty_model() {
    let mut request = chat_request("http://127.0.0.1:9".to_string());
    request.model = Some(" ".to_string());
    let error = post_openai_chat(request).expect_err("blank single model is rejected");

    assert_eq!(error, "AI provider model is required.");

    let mut request = chat_request("http://127.0.0.1:9".to_string());
    request.model = None;
    request.models = Some(vec!["".to_string(), "  ".to_string()]);
    let error = post_openai_chat(request).expect_err("blank models array is rejected");

    assert_eq!(error, "AI provider model is required.");
}

fn capture_one_chat_request() -> (std::net::SocketAddr, thread::JoinHandle<String>) {
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
    (address, server)
}

fn chat_request(base_url: String) -> AiClassificationChatRequest {
    AiClassificationChatRequest {
        base_url,
        api_key: None,
        model: Some("qwen/qwen3.6-flash".to_string()),
        models: None,
        messages: vec![json!({ "role": "user", "content": "classify" })],
        headers: serde_json::Map::new(),
        max_tokens: None,
        timeout_ms: None,
        temperature: None,
        chat_template_kwargs: serde_json::Map::new(),
        reasoning_format: None,
    }
}

fn request_body_json(request: &str) -> serde_json::Value {
    let body = request.split("\r\n\r\n").nth(1).expect("request body");
    serde_json::from_str(body).expect("request body json")
}
