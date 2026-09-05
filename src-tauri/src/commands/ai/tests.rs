use std::io::{Read, Write};
use std::net::TcpListener;
use std::thread;

use serde_json::json;

use super::{
    get_openai_models, post_anthropic_chat, post_openai_chat, AiClassificationAnthropicChatRequest,
    AiClassificationChatRequest, AiModelListRequest, MAX_MODEL_LIST_RESPONSE_BYTES,
};

#[test]
fn gets_openai_compatible_models_with_optional_bearer_key() {
    let body = r#"{"data":[{"id":"qwen2.5:7b"}]}"#;
    let (address, server) = capture_chat_response("200 OK", "", body);

    let response = get_openai_models(AiModelListRequest {
        base_url: format!("http://{address}/"),
        api_key: Some(" model-list-key ".to_string()),
    })
    .expect("model request succeeds");

    let request = server.join().expect("join server");
    assert_eq!(response.status, 200);
    assert_eq!(response.body, body);
    assert!(request.starts_with("GET /models HTTP/1.1"));
    assert!(request.contains("authorization: Bearer model-list-key"));
}

#[test]
fn does_not_forward_the_model_list_bearer_key_across_an_origin_redirect() {
    let destination_listener = TcpListener::bind("127.0.0.1:0").expect("bind destination server");
    let destination_address = destination_listener
        .local_addr()
        .expect("read destination address");
    let destination_server = thread::spawn(move || {
        let (mut stream, _) = destination_listener
            .accept()
            .expect("accept redirected request");
        let mut buffer = [0_u8; 2048];
        let bytes = stream.read(&mut buffer).expect("read redirected request");
        let request = String::from_utf8_lossy(&buffer[..bytes]).to_string();
        let body = r#"{"data":[{"id":"redirected-model"}]}"#;
        let response = format!(
            "HTTP/1.1 200 OK\r\nContent-Type: application/json\r\nContent-Length: {}\r\n\r\n{}",
            body.len(),
            body,
        );
        stream
            .write_all(response.as_bytes())
            .expect("write destination response");
        request
    });

    let redirect_listener = TcpListener::bind("127.0.0.1:0").expect("bind redirect server");
    let redirect_address = redirect_listener
        .local_addr()
        .expect("read redirect address");
    let redirect_server = thread::spawn(move || {
        let (mut stream, _) = redirect_listener
            .accept()
            .expect("accept model-list request");
        let mut buffer = [0_u8; 2048];
        let bytes = stream.read(&mut buffer).expect("read model-list request");
        let request = String::from_utf8_lossy(&buffer[..bytes]).to_string();
        let response = format!(
            "HTTP/1.1 302 Found\r\nLocation: http://{destination_address}/models\r\nContent-Length: 0\r\n\r\n",
        );
        stream
            .write_all(response.as_bytes())
            .expect("write redirect response");
        request
    });

    let response = get_openai_models(AiModelListRequest {
        base_url: format!("http://{redirect_address}"),
        api_key: Some("redirect-secret".to_string()),
    })
    .expect("redirected model request succeeds");

    let initial_request = redirect_server.join().expect("join redirect server");
    let redirected_request = destination_server.join().expect("join destination server");
    assert_eq!(response.status, 200);
    assert!(initial_request.contains("authorization: Bearer redirect-secret"));
    assert!(!redirected_request.contains("authorization:"));
    assert!(!redirected_request.contains("redirect-secret"));
}

#[test]
fn rejects_an_oversized_model_list_before_buffering_the_body() {
    let listener = TcpListener::bind("127.0.0.1:0").expect("bind test server");
    let address = listener.local_addr().expect("read test server address");
    let server = thread::spawn(move || {
        let (mut stream, _) = listener.accept().expect("accept request");
        let mut buffer = [0_u8; 2048];
        let _ = stream.read(&mut buffer).expect("read request");
        let response = format!(
            "HTTP/1.1 200 OK\r\nContent-Type: application/json\r\nContent-Length: {}\r\n\r\n",
            MAX_MODEL_LIST_RESPONSE_BYTES + 1,
        );
        stream
            .write_all(response.as_bytes())
            .expect("write response headers");
    });

    let error = get_openai_models(AiModelListRequest {
        base_url: format!("http://{address}"),
        api_key: None,
    })
    .expect_err("oversized response is rejected");

    server.join().expect("join server");
    assert_eq!(
        error,
        "AI provider model list response exceeded the 5 MB limit."
    );
}

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
fn preserves_numeric_retry_after_for_provider_backoff() {
    let body = r#"{"error":{"code":429,"message":"Rate limited"}}"#;
    let (address, server) =
        capture_chat_response("429 Too Many Requests", "Retry-After: 90\r\n", body);
    let response = post_openai_chat(chat_request(format!("http://{address}")))
        .expect("chat request returns provider response");

    server.join().expect("join server");
    assert_eq!(response.status, 429);
    assert_eq!(response.body, body);
    assert_eq!(response.retry_after_ms, Some(90_000));
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
fn posts_optional_structured_response_format() {
    let (address, server) = capture_one_chat_request();
    let mut request = chat_request(format!("http://{address}"));
    request.response_format = Some(json!({
        "type": "json_schema",
        "json_schema": { "name": "drifty_live_intent_classification" }
    }));

    post_openai_chat(request).expect("chat request succeeds");

    let request = server.join().expect("join server");
    let body = request_body_json(&request);
    assert_eq!(
        body.get("response_format"),
        Some(&json!({
            "type": "json_schema",
            "json_schema": { "name": "drifty_live_intent_classification" }
        }))
    );
}

#[test]
fn posts_provider_preferences_when_supplied() {
    let (address, server) = capture_one_chat_request();
    let mut request = chat_request(format!("http://{address}"));
    request.provider = serde_json::Map::from_iter([
        ("data_collection".to_string(), json!("deny")),
        ("zdr".to_string(), json!(true)),
    ]);

    if let Err(error) = post_openai_chat(request) {
        panic!("chat request succeeds: {error}");
    }

    let request = match server.join() {
        Ok(request) => request,
        Err(error) => std::panic::resume_unwind(error),
    };
    let body = request_body_json(&request);
    assert_eq!(
        body.get("provider"),
        Some(&json!({ "data_collection": "deny", "zdr": true }))
    );
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

#[test]
fn posts_anthropic_messages_body_with_key_and_version_headers() {
    let (address, server) = capture_one_chat_request();
    let request = anthropic_request(format!("http://{address}"));

    let response = post_anthropic_chat(request).expect("anthropic request succeeds");

    let request = server.join().expect("join server");
    assert_eq!(response.status, 200);
    assert!(request.starts_with("POST /messages HTTP/1.1"));
    assert!(request.contains("x-api-key: sk-ant-test"));
    assert!(request.contains("anthropic-version: 2023-06-01"));
    assert!(!request.contains("authorization:"));
    let body = request_body_json(&request);
    assert_eq!(body.get("model"), Some(&json!("claude-sonnet-5")));
    assert_eq!(body.get("max_tokens"), Some(&json!(256)));
    assert_eq!(
        body.get("messages"),
        Some(&json!([{ "role": "user", "content": "classify" }]))
    );
}

#[test]
fn defaults_anthropic_version_and_max_tokens_when_absent() {
    let (address, server) = capture_one_chat_request();
    let mut request = anthropic_request(format!("http://{address}"));
    request.anthropic_version = None;
    request.max_tokens = None;

    post_anthropic_chat(request).expect("anthropic request succeeds");

    let request = server.join().expect("join server");
    assert!(request.contains("anthropic-version: 2023-06-01"));
    let body = request_body_json(&request);
    assert_eq!(body.get("max_tokens"), Some(&json!(4096)));
}

#[test]
fn rejects_anthropic_request_without_api_key() {
    let mut request = anthropic_request("http://127.0.0.1:9".to_string());
    request.api_key = "  ".to_string();
    let error = post_anthropic_chat(request).expect_err("blank api key is rejected");

    assert_eq!(error, "Anthropic API key is required.");
}

#[test]
fn rejects_anthropic_request_without_model() {
    let mut request = anthropic_request("http://127.0.0.1:9".to_string());
    request.model = " ".to_string();
    let error = post_anthropic_chat(request).expect_err("blank model is rejected");

    assert_eq!(error, "Anthropic model is required.");
}

fn anthropic_request(base_url: String) -> AiClassificationAnthropicChatRequest {
    AiClassificationAnthropicChatRequest {
        base_url: Some(base_url),
        api_key: "sk-ant-test".to_string(),
        model: "claude-sonnet-5".to_string(),
        messages: vec![json!({ "role": "user", "content": "classify" })],
        max_tokens: Some(256),
        timeout_ms: None,
        temperature: Some(0.0),
        anthropic_version: Some("2023-06-01".to_string()),
    }
}

fn capture_one_chat_request() -> (std::net::SocketAddr, thread::JoinHandle<String>) {
    let body = r#"{"choices":[{"message":{"content":"{\"results\":[]}"}}]}"#;
    capture_chat_response("200 OK", "", body)
}

fn capture_chat_response(
    status: &'static str,
    extra_headers: &'static str,
    body: &'static str,
) -> (std::net::SocketAddr, thread::JoinHandle<String>) {
    let listener = TcpListener::bind("127.0.0.1:0").expect("bind test server");
    let address = listener.local_addr().expect("read test server address");
    let server = thread::spawn(move || {
        let (mut stream, _) = listener.accept().expect("accept request");
        let mut buffer = [0_u8; 8192];
        let bytes = stream.read(&mut buffer).expect("read request");
        let request = String::from_utf8_lossy(&buffer[..bytes]).to_string();
        let response = format!(
            "HTTP/1.1 {status}\r\nContent-Type: application/json\r\n{extra_headers}Content-Length: {}\r\n\r\n{}",
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
        provider: serde_json::Map::new(),
        max_tokens: None,
        timeout_ms: None,
        temperature: None,
        response_format: None,
        chat_template_kwargs: serde_json::Map::new(),
        reasoning_format: None,
    }
}

fn request_body_json(request: &str) -> serde_json::Value {
    let body = request.split("\r\n\r\n").nth(1).expect("request body");
    serde_json::from_str(body).expect("request body json")
}
