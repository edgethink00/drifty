//! Real lock/unlock checks against an explicitly supplied task-owned keychain.
//! The login keychain is never selected by these operations.
use core_foundation::base::TCFType;
use security_framework::os::macos::keychain::SecKeychain;
use std::path::Path;
use zeroize::Zeroizing;

#[link(name = "Security", kind = "framework")]
extern "C" {
    fn SecKeychainLock(keychain: security_framework_sys::base::SecKeychainRef) -> i32;
}

pub fn run(
    operation: &str,
    service: &str,
    directory: &str,
    request: &str,
) -> Result<serde_json::Value, String> {
    let directory = Path::new(directory)
        .canonicalize()
        .map_err(|_| "Fixture directory unavailable")?;
    let home = std::env::var("HOME").map_err(|_| "Missing fixture home")?;
    if !directory.starts_with(Path::new(&home).join(".codex/task-artifacts/drifty"))
        || !directory
            .file_name()
            .and_then(|v| v.to_str())
            .is_some_and(|v| v.starts_with("keychain-fixture-"))
    {
        return Err("Refusing non-fixture keychain directory".into());
    }
    let keychain_path = directory.join("fixture.keychain-db");
    if keychain_path.is_symlink() {
        return Err("Refusing symlink keychain".into());
    }
    let source = || {
        SecKeychain::open(&keychain_path).map_err(|e| format!("Fixture open status {}", e.code()))
    };
    let request_path = Path::new(request)
        .canonicalize()
        .map_err(|_| "Fixture request unavailable")?;
    if request_path.parent() != Some(directory.as_path()) {
        return Err("Refusing non-fixture request".into());
    }
    let input = Zeroizing::new(
        std::fs::read_to_string(request_path).map_err(|_| "Fixture request unreadable")?,
    );
    if input.len() > 65_536 {
        return Err("Fixture request too large".into());
    }
    let request: serde_json::Value =
        serde_json::from_str(&input).map_err(|_| "Invalid fixture request")?;
    match operation {
        "fixture-lock" => crate::credential_namespace::with_keychain_interaction(false, || {
            let keychain = source()?;
            let status = unsafe { SecKeychainLock(keychain.as_concrete_TypeRef()) };
            if status != 0 {
                return Err(format!("Fixture lock status {status}"));
            }
            Ok(serde_json::json!({"locked": true}))
        }),
        "fixture-unlock" => crate::credential_namespace::with_keychain_interaction(false, || {
            let password = Zeroizing::new(
                std::fs::read_to_string(directory.join("fixture-password"))
                    .map_err(|_| "Fixture password unavailable")?,
            );
            source()?
                .unlock(Some(&password))
                .map_err(|e| format!("Fixture unlock status {}", e.code()))?;
            Ok(serde_json::json!({"unlocked": true}))
        }),
        "fixture-write" => {
            let value = request["value"]
                .as_str()
                .ok_or("Missing synthetic session")?;
            crate::store::save_using(source, service, "synthetic", value, false)?;
            Ok(serde_json::json!({"saved": true}))
        }
        "fixture-matches" => {
            let expected = request["value"]
                .as_str()
                .ok_or("Missing expected synthetic session")?;
            let actual = crate::store::load_using(source, service, "synthetic")?;
            Ok(serde_json::json!({"matches": actual.as_deref() == Some(expected)}))
        }
        "fixture-clear" => {
            crate::store::clear_using(source, service, "synthetic", false)?;
            Ok(serde_json::json!({"cleared": true}))
        }
        _ => Err("Unknown fixture operation".into()),
    }
}
