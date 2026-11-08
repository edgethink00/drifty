use std::io::{Read, Write};
use std::net::TcpListener;
use std::thread;

use serde_json::json;

use super::{
    get_openai_models, is_loopback_base_url, post_anthropic_chat, post_openai_chat,
    post_openai_chat_with_context_limit, AiClassificationAnthropicChatRequest,
    AiClassificationChatRequest, AiModelListRequest, MAX_MODEL_LIST_RESPONSE_BYTES,
};

#[test]
fn recognizes_loopback_base_urls_that_must_skip_proxies() {
    for url in [
        "http://localhost:10100/v1",
        "http://LOCALHOST.:11434",
        "http://api.localhost:8080/v1",
        "http://127.0.0.1:1234/v1",
        "http://127.8.0.1/v1",
        "http://[::1]:8080/v1",
    ] {
        assert!(is_loopback_base_url(url), "{url}");
    }
    for url in [
        "https://api.openai.com/v1",
        "http://192.168.0.12:8080/v1",
        "http://localhost.example.com/v1",
        "not a url",
    ] {
        assert!(!is_loopback_base_url(url), "{url}");
    }
}

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
fn only_the_managed_endpoint_uses_the_token_check() {
    use super::managed_context::context_limit_for_base;
    assert_eq!(
        context_limit_for_base(" http://127.0.0.1:39217/v1/ "),
        Some(4096)
    );
    for base in [
        "https://api.openai.com/v1",
        "http://127.0.0.1:11434/v1",
        "http://localhost:39217/v1",
        "http://127.0.0.1:39217/v1?x=1",
        "http://127.0.0.1:39217/v1/other",
        "http://127.0.0.1:39217.example/v1",
    ] {
        assert_eq!(context_limit_for_base(base), None, "{base}");
    }
}

#[test]
fn counts_the_exact_generation_body_and_reserves_output_at_the_boundary() {
    let (address, stop, server) =
        capture_managed_requests("200 OK", "", r#"{"input_tokens":3072}"#);
    let mut request = chat_request(format!("http://{address}/v1"));
    request.max_tokens = Some(1024);
    request
        .chat_template_kwargs
        .insert("enable_thinking".into(), json!(false));
    request.response_format = Some(json!({"type":"json_object"}));
    request.reasoning_format = Some("none".into());
    request
        .headers
        .insert("X-Test".into(), json!("same-header"));
    let response = post_openai_chat_with_context_limit(request, Some(4096)).expect("fits exactly");
    stop.send(()).expect("stop server");
    let requests = server.join().expect("join server");
    assert_eq!(response.status, 200);
    assert_eq!(requests.len(), 2);
    assert!(requests[0].starts_with("POST /v1/chat/completions/input_tokens HTTP/1.1"));
    assert!(requests[1].starts_with("POST /v1/chat/completions HTTP/1.1"));
    assert_eq!(
        requests[0].split_once("\r\n\r\n").unwrap().1,
        requests[1].split_once("\r\n\r\n").unwrap().1
    );
    assert!(requests
        .iter()
        .all(|request| request.contains("x-test: same-header")));
    assert_eq!(request_body_json(&requests[1])["max_tokens"], 1024);
}

#[test]
fn rejects_over_budget_prompts_without_sending_generation() {
    for count in [3073, 8741, u64::MAX] {
        let body = format!(r#"{{"input_tokens":{count}}}"#);
        let (address, stop, server) = capture_managed_requests("200 OK", "", &body);
        let mut request = chat_request(format!("http://{address}/v1"));
        request.max_tokens = Some(1024);
        let response =
            post_openai_chat_with_context_limit(request, Some(4096)).expect("budget refusal");
        stop.send(()).expect("stop server");
        assert_eq!(server.join().expect("join server").len(), 1);
        assert_eq!(response.status, 400);
        let body: serde_json::Value = serde_json::from_str(&response.body).unwrap();
        assert_eq!(body["error"]["code"], "drifty_context_budget_exceeded");
        assert!(body["error"]["message"]
            .as_str()
            .unwrap()
            .contains(&count.to_string()));
    }
}

#[test]
fn never_generates_after_an_unverifiable_token_check() {
    let oversized = "x".repeat(64 * 1024 + 1);
    for (status, headers, body) in [
        ("200 OK", "", r#"{"input_tokens":"10"}"#),
        ("200 OK", "", r#"{"input_tokens":-1}"#),
        ("200 OK", "", r#"{"input_tokens":0}"#),
        ("200 OK", "", r#"{"input_tokens":1.5}"#),
        ("200 OK", "", "{}"),
        ("200 OK", "", "not JSON"),
        ("200 OK", "", oversized.as_str()),
        ("404 Not Found", "", "missing API"),
        (
            "307 Temporary Redirect",
            "Location: /redirect-target\r\n",
            "",
        ),
    ] {
        let (address, stop, server) = capture_managed_requests(status, headers, body);
        let mut request = chat_request(format!("http://{address}/v1"));
        request.max_tokens = Some(1024);
        assert!(post_openai_chat_with_context_limit(request, Some(4096)).is_err());
        stop.send(()).expect("stop server");
        let requests = server.join().expect("join server");
        assert_eq!(requests.len(), 1, "{status}: no redirect or generation");
    }
}

#[test]
fn requires_an_explicit_positive_managed_output_budget() {
    for budget in [None, Some(0)] {
        let mut request = chat_request("http://127.0.0.1:9/v1".into());
        request.max_tokens = budget;
        let error = post_openai_chat_with_context_limit(request, Some(4096)).unwrap_err();
        assert!(error.contains("positive output token budget"));
    }
}

#[test]
fn shares_the_deadline_between_token_check_and_generation() {
    assert_shared_managed_deadline(
        std::time::Duration::from_millis(800),
        std::time::Duration::from_millis(800),
        1200,
    );
}

#[test]
#[ignore = "181-second wall-clock qualification; run explicitly for managed deadline QA"]
fn enforces_the_real_180_second_managed_deadline() {
    assert_shared_managed_deadline(
        std::time::Duration::from_secs(2),
        std::time::Duration::from_secs(179),
        180_000,
    );
}

fn assert_shared_managed_deadline(
    token_delay: std::time::Duration,
    generation_delay: std::time::Duration,
    timeout_ms: u64,
) {
    let listener = TcpListener::bind("127.0.0.1:0").expect("bind delayed server");
    listener
        .set_nonblocking(true)
        .expect("nonblocking listener");
    let address = listener.local_addr().unwrap();
    let server = thread::spawn(move || {
        let mut requests = Vec::new();
        for (delay, body) in [
            (token_delay, r#"{"input_tokens":3072}"#),
            (
                generation_delay,
                r#"{"choices":[{"message":{"content":"late synthetic response"}}]}"#,
            ),
        ] {
            let accept_deadline = std::time::Instant::now() + std::time::Duration::from_secs(10);
            let mut stream = loop {
                match listener.accept() {
                    Ok((stream, _)) => break stream,
                    Err(error) if error.kind() == std::io::ErrorKind::WouldBlock => {
                        assert!(
                            std::time::Instant::now() < accept_deadline,
                            "expected managed request did not arrive"
                        );
                        thread::sleep(std::time::Duration::from_millis(5));
                    }
                    Err(error) => panic!("accept delayed request: {error}"),
                }
            };
            stream.set_nonblocking(false).unwrap();
            stream
                .set_read_timeout(Some(std::time::Duration::from_secs(5)))
                .unwrap();
            let mut bytes = Vec::new();
            loop {
                let mut chunk = [0_u8; 4096];
                let count = stream.read(&mut chunk).expect("read delayed request");
                assert!(count > 0, "request ended before its declared body");
                bytes.extend_from_slice(&chunk[..count]);
                assert!(bytes.len() < 128 * 1024, "bounded synthetic request");
                if let Some(header_end) = bytes.windows(4).position(|part| part == b"\r\n\r\n") {
                    let headers = String::from_utf8_lossy(&bytes[..header_end]).to_lowercase();
                    let length: usize = headers
                        .lines()
                        .find_map(|line| line.strip_prefix("content-length:"))
                        .expect("content length")
                        .trim()
                        .parse()
                        .unwrap();
                    if bytes.len() >= header_end + 4 + length {
                        break;
                    }
                }
            }
            requests.push(String::from_utf8(bytes).unwrap());
            thread::sleep(delay);
            // The late generation response may meet an already closed client.
            // Keep this evidence without treating a broken pipe as server failure.
            let _ = write!(stream, "HTTP/1.1 200 OK\r\nContent-Type: application/json\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{body}", body.len());
        }
        requests
    });
    let mut request = chat_request(format!("http://{address}/v1"));
    request.max_tokens = Some(1024);
    request.timeout_ms = Some(timeout_ms);
    let started = std::time::Instant::now();
    let response = post_openai_chat_with_context_limit(request, Some(4096));
    let elapsed = started.elapsed();
    let requests = server.join().expect("join delayed server");
    eprintln!("managed_deadline timeout_ms={timeout_ms} elapsed_ms={} token_delay_ms={} generation_delay_ms={} requests={} result={response:?}", elapsed.as_millis(), token_delay.as_millis(), generation_delay.as_millis(), requests.len());
    assert!(
        response.is_err(),
        "late response must not become a successful result"
    );
    assert_eq!(requests.len(), 2);
    assert!(requests[0].starts_with("POST /v1/chat/completions/input_tokens HTTP/1.1"));
    assert!(requests[1].starts_with("POST /v1/chat/completions HTTP/1.1"));
    assert_eq!(
        request_body_json(&requests[0]),
        request_body_json(&requests[1])
    );
}

fn capture_managed_requests(
    status: &str,
    headers: &str,
    body: &str,
) -> (
    std::net::SocketAddr,
    std::sync::mpsc::Sender<()>,
    thread::JoinHandle<Vec<String>>,
) {
    let listener = TcpListener::bind("127.0.0.1:0").expect("bind server");
    listener.set_nonblocking(true).unwrap();
    let address = listener.local_addr().unwrap();
    let token_response = format!(
        "HTTP/1.1 {status}\r\n{headers}Content-Length: {}\r\nConnection: close\r\n\r\n{body}",
        body.len()
    );
    let (stop, stopped) = std::sync::mpsc::channel();
    let server = thread::spawn(move || {
        let mut requests = Vec::new();
        let deadline = std::time::Instant::now() + std::time::Duration::from_secs(15);
        loop {
            match listener.accept() {
                Ok((mut stream, _)) => {
                    // BSD may inherit O_NONBLOCK from the listener. Read the
                    // complete HTTP body even when TCP splits its packets.
                    stream.set_nonblocking(false).unwrap();
                    stream
                        .set_read_timeout(Some(std::time::Duration::from_secs(2)))
                        .unwrap();
                    let mut bytes = Vec::new();
                    loop {
                        let mut buffer = [0; 4096];
                        let size = stream.read(&mut buffer).expect("read request");
                        assert!(size > 0, "request ended before its body");
                        bytes.extend_from_slice(&buffer[..size]);
                        if let Some(end) = bytes.windows(4).position(|part| part == b"\r\n\r\n") {
                            let headers = String::from_utf8_lossy(&bytes[..end]);
                            let length: usize = headers
                                .lines()
                                .find_map(|line| {
                                    line.to_lowercase()
                                        .strip_prefix("content-length:")
                                        .map(|value| value.trim().parse().unwrap())
                                })
                                .unwrap();
                            if bytes.len() >= end + 4 + length {
                                break;
                            }
                        }
                    }
                    let request = String::from_utf8(bytes).unwrap();
                    let response = if request.starts_with("POST /v1/chat/completions/input_tokens ")
                    {
                        token_response.as_str()
                    } else {
                        "HTTP/1.1 200 OK\r\nContent-Length: 2\r\nConnection: close\r\n\r\n{}"
                    };
                    // An oversized response may be refused as soon as its
                    // headers arrive, before the server finishes writing it.
                    let _ = stream.write_all(response.as_bytes());
                    requests.push(request);
                }
                Err(error) if error.kind() == std::io::ErrorKind::WouldBlock => {
                    if stopped.try_recv().is_ok() {
                        break;
                    }
                    assert!(std::time::Instant::now() < deadline, "server deadline");
                    thread::sleep(std::time::Duration::from_millis(2));
                }
                Err(error) => panic!("accept: {error}"),
            }
        }
        requests
    });
    (address, stop, server)
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
fn omits_temperature_and_renames_token_limit_for_direct_reasoning_models() {
    let (address, server) = capture_one_chat_request();
    let mut request = chat_request(format!("http://{address}"));
    request.model = Some("gpt-6-luna".to_string());
    request.max_tokens = Some(8192);
    request.temperature = Some(0.0);
    request.omit_temperature = true;
    request.use_max_completion_tokens = true;

    post_openai_chat(request).expect("chat request succeeds");

    let request = server.join().expect("join server");
    let body = request_body_json(&request);
    assert!(body.get("temperature").is_none());
    assert!(body.get("max_tokens").is_none());
    assert_eq!(body.get("max_completion_tokens"), Some(&json!(8192)));
}

#[test]
fn keeps_the_default_temperature_when_no_override_is_requested() {
    let (address, server) = capture_one_chat_request();
    let request = chat_request(format!("http://{address}"));

    post_openai_chat(request).expect("chat request succeeds");

    let request = server.join().expect("join server");
    let body = request_body_json(&request);
    assert_eq!(body.get("temperature"), Some(&json!(0.1)));
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
fn sends_anthropic_system_text_at_the_top_level_and_omits_blank_system() {
    let (address, server) = capture_one_chat_request();
    let mut request = anthropic_request(format!("http://{address}"));
    request.system = Some("  Follow the rubric.  ".to_string());

    post_anthropic_chat(request).expect("anthropic request succeeds");

    let body = request_body_json(&server.join().expect("join server"));
    assert_eq!(body.get("system"), Some(&json!("Follow the rubric.")));
    assert_eq!(
        body.get("messages"),
        Some(&json!([{ "role": "user", "content": "classify" }]))
    );

    let (address, server) = capture_one_chat_request();
    let mut request = anthropic_request(format!("http://{address}"));
    request.system = Some("   ".to_string());
    post_anthropic_chat(request).expect("anthropic request succeeds");
    let body = request_body_json(&server.join().expect("join server"));
    assert!(body.get("system").is_none());
}

#[test]
fn disables_anthropic_thinking_only_when_requested() {
    let (address, server) = capture_one_chat_request();
    let mut request = anthropic_request(format!("http://{address}"));
    request.disable_thinking = true;
    post_anthropic_chat(request).expect("anthropic request succeeds");
    let body = request_body_json(&server.join().expect("join server"));
    assert_eq!(body.get("thinking"), Some(&json!({ "type": "disabled" })));

    let (address, server) = capture_one_chat_request();
    post_anthropic_chat(anthropic_request(format!("http://{address}")))
        .expect("anthropic request succeeds");
    let body = request_body_json(&server.join().expect("join server"));
    assert!(body.get("thinking").is_none());
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
        system: None,
        disable_thinking: false,
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

#[test]
fn reports_a_provider_timeout_as_a_timeout() {
    let listener = TcpListener::bind("127.0.0.1:0").expect("bind silent server");
    let address = listener.local_addr().unwrap();
    let server = thread::spawn(move || {
        let (mut stream, _) = listener.accept().expect("accept request");
        stream
            .set_read_timeout(Some(std::time::Duration::from_secs(5)))
            .unwrap();
        let mut chunk = [0_u8; 4096];
        let _ = stream.read(&mut chunk);
        // Never answer within the client's deadline.
        thread::sleep(std::time::Duration::from_millis(1500));
    });
    let mut request = chat_request(format!("http://{address}/v1"));
    request.timeout_ms = Some(400);
    let error = post_openai_chat(request).expect_err("a silent provider must time out");
    server.join().expect("join silent server");
    assert_eq!(error, "AI provider did not respond within 1 second.");
    assert!(
        !error.contains("127.0.0.1"),
        "the message must not expose the endpoint URL"
    );
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
        omit_temperature: false,
        use_max_completion_tokens: false,
        response_format: None,
        chat_template_kwargs: serde_json::Map::new(),
        reasoning_format: None,
    }
}

fn request_body_json(request: &str) -> serde_json::Value {
    let body = request.split("\r\n\r\n").nth(1).expect("request body");
    serde_json::from_str(body).expect("request body json")
}
