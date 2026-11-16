//! GUI-session smoke for synthetic entries only. Never use a real login slot.
//! Args: <operation> <so.drifty.qa.keychain.* service> <result.json>
#[cfg(target_os = "macos")]
#[path = "../src/auth_session_store/macos.rs"]
mod store;

#[cfg(target_os = "macos")]
#[path = "../src/credential_namespace.rs"]
mod credential_namespace;

#[cfg(target_os = "macos")]
#[path = "auth_keychain_probe/fixture.rs"]
mod fixture;

#[cfg(target_os = "macos")]
fn main() {
    let args: Vec<String> = std::env::args().collect();
    assert!(args.len() == 4 || args.len() == 6);
    let (operation, service, output) = (&args[1], &args[2], &args[3]);
    assert!(service.starts_with("so.drifty.qa.keychain."));
    assert!(service
        .bytes()
        .all(|b| b.is_ascii_alphanumeric() || b".-".contains(&b)));
    let started = std::time::Instant::now();
    let result: Result<serde_json::Value, String> = (|| {
        if operation.starts_with("fixture-") {
            if args.len() != 6 {
                return Err("Missing isolated fixture arguments".into());
            }
            return fixture::run(operation, service, &args[4], &args[5]);
        }
        match operation.as_str() {
            "legacy-write" => {
                keyring::Entry::new(service, "synthetic")
                    .map_err(|e| e.to_string())?
                    .set_password("synthetic-fixture")
                    .map_err(|e| e.to_string())?;
                Ok(serde_json::json!({"saved": true}))
            }
            "read" => Ok(
                serde_json::json!({"matches": store::load(service, "synthetic")?.as_deref() == Some("synthetic-fixture")}),
            ),
            "missing" => {
                Ok(serde_json::json!({"missing": store::load(service, "synthetic")?.is_none()}))
            }
            "background-stress" => {
                let mut denied = 0;
                let mut successful = 0;
                for _ in 0..100 {
                    for result in [
                        store::load(service, "synthetic").map(|_| ()),
                        store::save(service, "synthetic", "synthetic-fixture", false),
                    ] {
                        match result {
                            Ok(()) => successful += 1,
                            Err(error) if error == "AUTH_SESSION_ACCESS_DENIED" => denied += 1,
                            Err(error) => return Err(error),
                        }
                    }
                }
                Ok(
                    serde_json::json!({"operations": 200, "denied": denied, "successful": successful}),
                )
            }
            "background-write" | "explicit-write" => {
                store::save(
                    service,
                    "synthetic",
                    "synthetic-fixture",
                    operation == "explicit-write",
                )?;
                Ok(serde_json::json!({"saved": true}))
            }
            "foreign-write" => {
                store::save(service, "synthetic", "synthetic-foreign", false)?;
                Ok(serde_json::json!({"saved": true}))
            }
            "clear" | "background-clear" => {
                store::clear(service, "synthetic", operation == "clear")?;
                Ok(serde_json::json!({"cleared": true}))
            }
            _ => Err("Unknown probe operation".into()),
        }
    })();
    let report = serde_json::json!({"operation": operation, "ok": result.is_ok(), "result": result,
        "elapsedMs": started.elapsed().as_millis()});
    std::fs::write(output, serde_json::to_vec_pretty(&report).unwrap()).unwrap();
}

#[cfg(not(target_os = "macos"))]
fn main() {
    panic!("This probe requires macOS");
}
