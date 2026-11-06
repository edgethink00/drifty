//! Screen evidence uses a native verified identity, never a WebView-selected
//! profile. Credential changes revoke read capabilities before credential I/O.
use base64::{engine::general_purpose::URL_SAFE_NO_PAD, Engine};
use drifty_screen_context_core::{
    lease::{AccountGate, AccountLeaseId, AccountReadLease, AccountReply, AccountTransition},
    ScopeId,
};
use serde::{Deserialize, Serialize};
use std::{
    io::Read,
    sync::{
        atomic::{AtomicBool, AtomicU64, Ordering},
        Mutex,
    },
    time::{Duration, Instant, SystemTime, UNIX_EPOCH},
};
use tauri::{AppHandle, Manager};
use uuid::Uuid;
use zeroize::{Zeroize, Zeroizing};

const UNAVAILABLE: &str = "screen_context_account_unavailable";
const INVALIDATED: &str = "screen_context_account_changed";
const MAX_SESSION_BYTES: usize = 64 * 1024;
const MAX_AUTH_REPLY_BYTES: u64 = 64 * 1024;
const LEASE_SECONDS: u64 = 15 * 60;

#[derive(Default)]
pub struct ScreenContextAccount {
    pub(crate) gate: AccountGate,
    pub(crate) runtime: super::screen_context_runtime::ScreenContextRuntime,
    credential_epoch: AtomicU64,
    credential_closed: AtomicBool,
    credential_io: Mutex<()>,
}

impl ScreenContextAccount {
    pub(crate) fn shutdown(&self) {
        self.credential_closed.store(true, Ordering::Release);
        let _ = self.revoke();
        self.runtime.shutdown();
    }
    /// Serializes only OS credential operations, not network verification. A
    /// superseded write cannot restore an earlier account's saved credentials.
    pub fn change_saved_session<T>(
        &self,
        change: impl FnOnce() -> Result<T, String>,
    ) -> Result<T, String> {
        self.revoke()?;
        let epoch = self
            .credential_epoch
            .fetch_update(Ordering::AcqRel, Ordering::Acquire, |v| v.checked_add(1))
            .map_err(|_| {
                self.credential_closed.store(true, Ordering::Release);
                INVALIDATED.to_owned()
            })?
            + 1;
        let _io = self
            .credential_io
            .lock()
            .map_err(|_| UNAVAILABLE.to_owned())?;
        if self.credential_closed.load(Ordering::Acquire)
            || self.credential_epoch.load(Ordering::Acquire) != epoch
        {
            return Err(INVALIDATED.to_owned());
        }
        let result = change()?;
        if self.credential_closed.load(Ordering::Acquire)
            || self.credential_epoch.load(Ordering::Acquire) != epoch
        {
            return Err(INVALIDATED.to_owned());
        }
        Ok(result)
    }

    pub fn revoke(&self) -> Result<(), String> {
        let result = self
            .gate
            .begin_transition()
            .map(|_| ())
            .map_err(|_| INVALIDATED.to_owned());
        self.runtime.invalidate_now();
        result
    }

    fn begin(&self) -> Result<AccountTransition, String> {
        if self.credential_closed.load(Ordering::Acquire) {
            return Err(INVALIDATED.to_owned());
        }
        let transition = self
            .gate
            .begin_transition()
            .map_err(|_| INVALIDATED.to_owned())?;
        self.runtime.invalidate_now();
        Ok(transition)
    }

    fn verified_identity(
        &self,
        app: &AppHandle,
        expected_user_id: Option<Uuid>,
        current: impl Fn() -> bool,
    ) -> Result<Identity, String> {
        let saved = {
            let _io = self
                .credential_io
                .lock()
                .map_err(|_| UNAVAILABLE.to_owned())?;
            if self.credential_closed.load(Ordering::Acquire) || !current() {
                return Err(INVALIDATED.to_owned());
            }
            crate::auth_session_store::load_saved_session(app)
                .map_err(|_| UNAVAILABLE.to_owned())?
                .map(Zeroizing::new)
        };
        let now = unix_seconds()?;
        let identity = resolve_identity(
            saved.as_deref().map(|v| v.as_str()),
            expected_user_id,
            now,
            option_env!("VITE_SUPABASE_URL"),
            option_env!("VITE_SUPABASE_ANON_KEY"),
            verify_user,
        )?;
        if self.credential_closed.load(Ordering::Acquire) || !current() {
            return Err(INVALIDATED.to_owned());
        }
        Ok(identity)
    }

    fn bind(
        &self,
        app: &AppHandle,
        transition: AccountTransition,
        expected_user_id: Option<Uuid>,
    ) -> Result<AccountReply<AccountBinding>, String> {
        let identity = self.verified_identity(app, expected_user_id, || transition.is_current())?;
        let (seconds, expires_at_ms) = grant_duration(&identity, unix_seconds()?)?;
        let id = self
            .gate
            .bind_verified(
                transition,
                identity.scope,
                Instant::now() + Duration::from_secs(seconds),
            )
            .map_err(|_| INVALIDATED.to_owned())?;
        let lease = self.gate.read(id).map_err(|_| INVALIDATED.to_owned())?;
        self.runtime.bind(app, lease.clone())?;
        lease
            .reply(AccountBinding {
                mode: identity.mode,
                expires_at_ms,
            })
            .map_err(|_| INVALIDATED.to_owned())
    }

    fn renew(
        &self,
        app: &AppHandle,
        lease: AccountReadLease,
        expected_user_id: Option<Uuid>,
    ) -> Result<AccountReply<AccountBinding>, String> {
        let result = (|| {
            let identity = self.verified_identity(app, expected_user_id, || lease.is_current())?;
            let (seconds, expires_at_ms) = grant_duration(&identity, unix_seconds()?)?;
            self.gate
                .renew_verified(
                    &lease,
                    &identity.scope,
                    Instant::now() + Duration::from_secs(seconds),
                )
                .map_err(|_| INVALIDATED.to_owned())?;
            lease
                .clone()
                .reply(AccountBinding {
                    mode: identity.mode,
                    expires_at_ms,
                })
                .map_err(|_| INVALIDATED.to_owned())
        })();
        // A rejected verification closes this grant immediately. If login or
        // logout won the race, its different grant remains untouched.
        if result.is_err() {
            lease.revoke();
        }
        result
    }
}

fn grant_duration(identity: &Identity, verified_now: u64) -> Result<(u64, u64), String> {
    // JWT exp is a whole UTC second. Leave a second so fractional clock
    // time cannot extend the native capability beyond token expiry.
    let seconds = identity
        .expires_at
        .saturating_sub(verified_now.saturating_add(1))
        .min(LEASE_SECONDS);
    if seconds == 0 {
        return Err(UNAVAILABLE.to_owned());
    }
    Ok((seconds, (verified_now + seconds) * 1000))
}

#[derive(Serialize, PartialEq, Eq, Debug)]
#[serde(rename_all = "snake_case")]
pub enum AccountMode {
    Local,
    Account,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AccountBinding {
    mode: AccountMode,
    expires_at_ms: u64,
}

struct Identity {
    scope: ScopeId,
    mode: AccountMode,
    expires_at: u64,
}
#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct SavedSession {
    access_token: String,
}
impl Drop for SavedSession {
    fn drop(&mut self) {
        self.access_token.zeroize();
    }
}
#[derive(Deserialize)]
struct Claims {
    sub: Uuid,
    iss: String,
    exp: u64,
}
#[derive(Deserialize)]
struct VerifiedUser {
    id: Uuid,
}

fn unix_seconds() -> Result<u64, String> {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|v| v.as_secs())
        .map_err(|_| UNAVAILABLE.to_owned())
}

fn auth_origin(configured: Option<&str>) -> Result<url::Url, String> {
    let origin = url::Url::parse(configured.ok_or_else(|| UNAVAILABLE.to_owned())?)
        .map_err(|_| UNAVAILABLE.to_owned())?;
    if origin.scheme() != "https"
        || origin.host_str().is_none()
        || !origin.username().is_empty()
        || origin.password().is_some()
        || origin.path() != "/"
        || origin.query().is_some()
        || origin.fragment().is_some()
    {
        return Err(UNAVAILABLE.to_owned());
    }
    Ok(origin)
}

fn resolve_identity(
    saved: Option<&str>,
    expected: Option<Uuid>,
    now: u64,
    configured_origin: Option<&str>,
    configured_key: Option<&str>,
    verify: impl FnOnce(&url::Url, &str, &str) -> Result<Uuid, String>,
) -> Result<Identity, String> {
    let Some(saved) = saved else {
        if expected.is_some() {
            return Err(UNAVAILABLE.to_owned());
        }
        return Ok(Identity {
            scope: ScopeId::from_profile("device-local-v1").map_err(|_| UNAVAILABLE.to_owned())?,
            mode: AccountMode::Local,
            expires_at: now + LEASE_SECONDS,
        });
    };
    if saved.len() > MAX_SESSION_BYTES {
        return Err(UNAVAILABLE.to_owned());
    }
    let session: SavedSession = serde_json::from_str(saved).map_err(|_| UNAVAILABLE.to_owned())?;
    let origin = auth_origin(configured_origin)?;
    let key = configured_key
        .filter(|v| !v.is_empty() && v.len() <= 16 * 1024)
        .ok_or_else(|| UNAVAILABLE.to_owned())?;
    let mut parts = session.access_token.split('.');
    let header = parts.next().ok_or_else(|| UNAVAILABLE.to_owned())?;
    let payload = parts.next().ok_or_else(|| UNAVAILABLE.to_owned())?;
    let signature = parts.next().ok_or_else(|| UNAVAILABLE.to_owned())?;
    if header.is_empty() || signature.is_empty() || parts.next().is_some() {
        return Err(UNAVAILABLE.to_owned());
    }
    let claims_bytes = Zeroizing::new(
        URL_SAFE_NO_PAD
            .decode(payload)
            .map_err(|_| UNAVAILABLE.to_owned())?,
    );
    let claims: Claims =
        serde_json::from_slice(&claims_bytes).map_err(|_| UNAVAILABLE.to_owned())?;
    let issuer = origin.join("auth/v1").map_err(|_| UNAVAILABLE.to_owned())?;
    // These unverified claims only reject. They never authorize a profile.
    if claims.iss != issuer.as_str() || claims.exp <= now || expected != Some(claims.sub) {
        return Err(UNAVAILABLE.to_owned());
    }
    let verified =
        verify(&origin, key, &session.access_token).map_err(|_| UNAVAILABLE.to_owned())?;
    if verified != claims.sub {
        return Err(UNAVAILABLE.to_owned());
    }
    let scope = ScopeId::from_profile(&format!("account-v1:{}:{verified}", issuer.as_str()))
        .map_err(|_| UNAVAILABLE.to_owned())?;
    Ok(Identity {
        scope,
        mode: AccountMode::Account,
        expires_at: claims.exp,
    })
}

fn verify_user(origin: &url::Url, key: &str, token: &str) -> Result<Uuid, String> {
    let client = reqwest::blocking::Client::builder()
        .redirect(reqwest::redirect::Policy::none())
        .timeout(Duration::from_secs(6))
        .connect_timeout(Duration::from_secs(3))
        .build()
        .map_err(|_| UNAVAILABLE.to_owned())?;
    let endpoint = origin
        .join("auth/v1/user")
        .map_err(|_| UNAVAILABLE.to_owned())?;
    let response = client
        .get(endpoint)
        .header("apikey", key)
        .bearer_auth(token)
        .send()
        .map_err(|_| UNAVAILABLE.to_owned())?;
    if !response.status().is_success()
        || response
            .content_length()
            .is_some_and(|v| v > MAX_AUTH_REPLY_BYTES)
    {
        return Err(UNAVAILABLE.to_owned());
    }
    let mut bytes = Zeroizing::new(Vec::new());
    response
        .take(MAX_AUTH_REPLY_BYTES + 1)
        .read_to_end(&mut bytes)
        .map_err(|_| UNAVAILABLE.to_owned())?;
    if bytes.len() as u64 > MAX_AUTH_REPLY_BYTES {
        return Err(UNAVAILABLE.to_owned());
    }
    serde_json::from_slice::<VerifiedUser>(&bytes)
        .map(|v| v.id)
        .map_err(|_| UNAVAILABLE.to_owned())
}

#[tauri::command]
pub async fn screen_context_bind_account(
    app: AppHandle,
    expected_user_id: Option<String>,
    lease_id: Option<AccountLeaseId>,
) -> Result<AccountReply<AccountBinding>, String> {
    let expected = expected_user_id
        .map(|v| Uuid::parse_str(&v))
        .transpose()
        .map_err(|_| UNAVAILABLE.to_owned())?;
    if let Some(id) = lease_id {
        let lease = app
            .state::<ScreenContextAccount>()
            .gate
            .read(id)
            .map_err(|_| INVALIDATED.to_owned())?;
        return tauri::async_runtime::spawn_blocking(move || {
            app.state::<ScreenContextAccount>()
                .renew(&app, lease, expected)
        })
        .await
        .map_err(|_| UNAVAILABLE.to_owned())?;
    }
    let transition = app.state::<ScreenContextAccount>().begin()?;
    tauri::async_runtime::spawn_blocking(move || {
        app.state::<ScreenContextAccount>()
            .bind(&app, transition, expected)
    })
    .await
    .map_err(|_| UNAVAILABLE.to_owned())?
}

#[tauri::command]
pub fn screen_context_revoke_account(
    state: tauri::State<'_, ScreenContextAccount>,
) -> Result<(), String> {
    state.revoke()
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::cell::Cell;
    fn saved(sub: Uuid, iss: &str, exp: u64) -> String {
        let claims = serde_json::json!({"sub":sub,"iss":iss,"exp":exp});
        serde_json::json!({"accessToken":format!("e30.{}.signature", URL_SAFE_NO_PAD.encode(claims.to_string())),"refreshToken":"OWNED"}).to_string()
    }
    #[test]
    fn renewed_duration_stays_bounded_by_verified_token_expiry_and_fifteen_minutes() {
        let identity = |expires_at| Identity {
            scope: ScopeId::from_profile("owned-renewal-test").unwrap(),
            mode: AccountMode::Account,
            expires_at,
        };
        assert_eq!(
            grant_duration(&identity(10_000), 100).unwrap(),
            (900, 1_000_000)
        );
        assert_eq!(grant_duration(&identity(108), 100).unwrap(), (7, 107_000));
        assert!(grant_duration(&identity(101), 100).is_err());
        assert!(grant_duration(&identity(99), 100).is_err());
    }
    #[test]
    fn local_requires_absent_credentials_and_no_expected_account() {
        let no_network = |_: &url::Url, _: &str, _: &str| -> Result<Uuid, String> {
            panic!("local must not request auth")
        };
        assert!(matches!(
            resolve_identity(None, None, 100, None, None, no_network)
                .unwrap()
                .mode,
            AccountMode::Local
        ));
        assert!(resolve_identity(None, Some(Uuid::new_v4()), 100, None, None, no_network).is_err());
        assert!(resolve_identity(Some("invalid"), None, 100, None, None, no_network).is_err());
    }
    #[test]
    fn native_server_identity_is_required_and_untrusted_issuer_cannot_select_an_endpoint() {
        let a = Uuid::new_v4();
        let b = Uuid::new_v4();
        let origin = Some("https://owned.example");
        let issuer = "https://owned.example/auth/v1";
        let calls = Cell::new(0);
        let verify = |url: &url::Url, key: &str, _: &str| {
            calls.set(calls.get() + 1);
            assert_eq!(url.as_str(), "https://owned.example/");
            assert_eq!(key, "public");
            Ok(a)
        };
        let session = saved(a, issuer, 1000);
        let identity =
            resolve_identity(Some(&session), Some(a), 100, origin, Some("public"), verify).unwrap();
        assert_eq!(identity.mode, AccountMode::Account);
        assert_eq!(calls.get(), 1);
        assert!(resolve_identity(
            Some(&session),
            Some(a),
            100,
            origin,
            Some("public"),
            |_, _, _| Ok(b)
        )
        .is_err());
        for (session, expected) in [
            (saved(a, "https://foreign.example/auth/v1", 1000), Some(a)),
            (saved(a, issuer, 100), Some(a)),
            (saved(a, issuer, 1000), Some(b)),
            (saved(a, issuer, 1000), None),
        ] {
            assert!(resolve_identity(
                Some(&session),
                expected,
                100,
                origin,
                Some("public"),
                |_, _, _| panic!("must reject before network")
            )
            .is_err());
        }
    }
    #[test]
    fn configuration_and_errors_do_not_accept_remote_scope_or_echo_credentials() {
        for origin in [
            "http://owned.example",
            "https://user:secret@owned.example",
            "https://owned.example/path",
            "https://owned.example?url=foreign",
            "https://owned.example/#fragment",
        ] {
            assert!(auth_origin(Some(origin)).is_err());
        }
        let a = Uuid::new_v4();
        let session = saved(a, "https://owned.example/auth/v1", 1000);
        let error = resolve_identity(
            Some(&session),
            Some(a),
            100,
            Some("https://owned.example"),
            Some("public"),
            |_, _, _| Err("OWNED_TOKEN_ECHO".into()),
        )
        .err()
        .unwrap();
        // Sanitize the injected transport too, not only reqwest's normal path.
        assert_eq!(error, UNAVAILABLE);
    }
    #[test]
    fn credential_change_revokes_even_when_os_write_fails() {
        let state = ScreenContextAccount::default();
        let id = state
            .gate
            .bind_verified(
                state.begin().unwrap(),
                ScopeId::from_profile("owned").unwrap(),
                Instant::now() + Duration::from_secs(10),
            )
            .unwrap();
        let held = state.gate.read(id).unwrap();
        assert!(state
            .change_saved_session::<()>(|| Err("owned OS unavailable".into()))
            .is_err());
        assert!(!held.is_current());
        assert!(state.gate.read(id).is_err());
    }
    #[test]
    fn app_exit_revokes_replies_and_prevents_late_bind_or_credential_writes() {
        let state = ScreenContextAccount::default();
        let id = state
            .gate
            .bind_verified(
                state.begin().unwrap(),
                ScopeId::from_profile("owned").unwrap(),
                Instant::now() + Duration::from_secs(10),
            )
            .unwrap();
        let response = state
            .gate
            .read(id)
            .unwrap()
            .reply("OWNED_PRIVATE_TEXT")
            .unwrap();
        state.shutdown();
        assert!(serde_json::to_vec(&response).is_err());
        assert!(state.begin().is_err());
        let called = Cell::new(false);
        assert!(state
            .change_saved_session(|| {
                called.set(true);
                Ok(())
            })
            .is_err());
        assert!(!called.get());
    }

    #[test]
    fn screen_context_revoke_ipc_is_limited_to_the_main_window() {
        let app = tauri::test::mock_builder()
            .manage(ScreenContextAccount::default())
            .invoke_handler(tauri::generate_handler![screen_context_revoke_account])
            .build(crate::app_context())
            .unwrap();
        let main = app.get_webview_window("main").unwrap_or_else(|| {
            tauri::WebviewWindowBuilder::new(&app, "main", Default::default())
                .build()
                .unwrap()
        });
        let other =
            tauri::WebviewWindowBuilder::new(&app, "screen-context-qa-denied", Default::default())
                .build()
                .unwrap();
        let invoke = |window: &tauri::WebviewWindow<tauri::test::MockRuntime>| {
            tauri::test::get_ipc_response(
                window,
                tauri::webview::InvokeRequest {
                    cmd: "screen_context_revoke_account".into(),
                    callback: tauri::ipc::CallbackFn(0),
                    error: tauri::ipc::CallbackFn(1),
                    url: "tauri://localhost".parse().unwrap(),
                    body: tauri::ipc::InvokeBody::Json(serde_json::json!({})),
                    headers: Default::default(),
                    invoke_key: tauri::test::INVOKE_KEY.into(),
                },
            )
        };
        assert!(invoke(&main).is_ok());
        assert!(invoke(&other).is_err());
    }
}
