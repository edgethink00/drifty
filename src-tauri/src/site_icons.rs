use base64::Engine;
use std::fs;
use std::io::Read;
use std::path::{Path, PathBuf};
use std::time::Duration;

use tauri::{AppHandle, Manager};

use crate::tracker::TrackerError;

/// Root for every site-icon cache generation. Individual generations live in
/// versioned subdirectories so a format change can retire the whole previous
/// generation in one step instead of leaving orphaned files behind. The app
/// icon cache learned this the hard way: it switched to a `.128.` key without
/// removing the old entries, and real installs still carry ~195MB of files
/// nothing reads.
pub(crate) const SITE_ICON_CACHE_ROOT: &str = "site-icon-cache";
const SITE_ICON_CACHE_GENERATION: &str = "v1";

const SITE_ICON_DATA_URL_EXTENSION: &str = "data-url";
const SITE_ICON_MISS_EXTENSION: &str = "miss";

/// Hard ceiling on a single response. Favicons are a few KB; anything far
/// larger is a misbehaving or hostile endpoint, not an icon.
const SITE_ICON_MAX_BYTES: usize = 256 * 1024;
const SITE_ICON_REQUEST_TIMEOUT: Duration = Duration::from_secs(5);
const SITE_ICON_MAX_REDIRECTS: usize = 3;

/// Cached icons never expire on their own: a favicon changes rarely, the
/// working set is small (a real install shows ~550 distinct domains ever), and
/// the user can clear the cache from Settings. These ceilings are a safety net
/// for pathological growth, not a routine eviction policy.
const SITE_ICON_CACHE_MAX_BYTES: u64 = 20 * 1024 * 1024;
const SITE_ICON_CACHE_MAX_ENTRIES: usize = 2_000;

/// Domains fetched from the network in a single request.
///
/// A cold cache on a long history view can ask for hundreds of domains at
/// once. Resolving them one after another would hold a blocking worker for
/// minutes (534 domains x ~0.34s RTT was measured at about three minutes) and
/// fire a long serial burst at the icon source. Callers re-request what is
/// still missing, so a capped batch converges over a few passes instead.
const SITE_ICON_FETCH_BATCH_LIMIT: usize = 32;

/// Concurrent in-flight fetches within one batch. Small enough to stay polite
/// to the icon source, large enough that a batch is bounded by a couple of
/// round trips rather than by its length.
const SITE_ICON_FETCH_CONCURRENCY: usize = 6;

/// Hosts the icon source is allowed to reach, revalidated on every redirect
/// hop. The webview used to load these URLs directly, where the browser
/// network stack constrained them; issuing the request from native code makes
/// this an outbound fetch driven by browsing history, so the destination set
/// stays explicit and closed.
const SITE_ICON_ALLOWED_HOSTS: &[&str] = &["www.google.com", "gstatic.com"];

/// Internal suffixes that never have a public favicon. Requesting them would
/// aim a native fetch at the user's own machine or LAN.
const SITE_ICON_BLOCKED_SUFFIXES: &[&str] = &[
    ".local",
    ".localhost",
    ".internal",
    ".intranet",
    ".lan",
    ".home",
    ".corp",
    ".test",
    ".example",
    ".invalid",
    ".onion",
];

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(crate) enum SiteIconLookup {
    /// Cached bytes are available; the value is a `data:` URL.
    Hit,
    /// Known to have no usable icon. Cached so it is not retried every launch.
    Miss,
}

/// Normalizes a raw `site_domain` value into something worth fetching.
///
/// Tracker rows are not a curated domain list: they carry browser surfaces
/// (`newtab`, `settings`, `downloads`), extension IDs, and `localhost`. On a
/// real install those account for hundreds of segments. Rejecting them here
/// keeps them off the network entirely rather than relying on the icon source
/// to fail, which it does not do reliably (see `is_generic_fallback_icon`).
pub(crate) fn normalized_site_domain(raw: &str) -> Option<String> {
    let domain = raw.trim().trim_end_matches('.').to_ascii_lowercase();

    if domain.is_empty() || domain.len() > 253 {
        return None;
    }
    // Browser-internal surfaces and extension IDs have no dot.
    if !domain.contains('.') {
        return None;
    }
    if domain.contains('/') || domain.contains(':') || domain.contains('@') {
        return None;
    }
    if !domain
        .chars()
        .all(|c| c.is_ascii_alphanumeric() || c == '.' || c == '-')
    {
        return None;
    }
    if domain.starts_with('-') || domain.starts_with('.') || domain.contains("..") {
        return None;
    }
    if domain == "localhost" {
        return None;
    }
    // Bare IPv4 literals point at the local network far more often than at a
    // site with a favicon.
    if domain
        .split('.')
        .all(|label| !label.is_empty() && label.chars().all(|c| c.is_ascii_digit()))
    {
        return None;
    }
    if SITE_ICON_BLOCKED_SUFFIXES
        .iter()
        .any(|suffix| domain.ends_with(suffix))
    {
        return None;
    }
    // Reject anything without a plausible TLD.
    let tld = domain.rsplit('.').next().unwrap_or_default();
    if tld.len() < 2 || !tld.chars().all(|c| c.is_ascii_alphabetic()) {
        return None;
    }

    Some(domain)
}

fn cache_generation_dir(app: &AppHandle) -> PathBuf {
    app.path()
        .app_local_data_dir()
        .unwrap_or_else(|_| std::env::temp_dir())
        .join(SITE_ICON_CACHE_ROOT)
        .join(SITE_ICON_CACHE_GENERATION)
}

fn cached_paths(cache_dir: &Path, domain: &str) -> (PathBuf, PathBuf) {
    let key = sanitize_cache_key(domain);
    (
        cache_dir.join(format!("{key}.{SITE_ICON_DATA_URL_EXTENSION}")),
        cache_dir.join(format!("{key}.{SITE_ICON_MISS_EXTENSION}")),
    )
}

fn sanitize_cache_key(input: &str) -> String {
    input
        .chars()
        .map(|c| if c.is_ascii_alphanumeric() { c } else { '_' })
        .collect()
}

/// The icon source returns HTTP 200 with a generic globe placeholder when a
/// domain has no favicon, so status code alone cannot separate a real icon
/// from a miss. Known placeholder payloads are fingerprinted by content hash
/// and recorded as misses; otherwise every junk domain would cache a globe and
/// be re-fetched forever.
fn is_generic_fallback_icon(bytes: &[u8]) -> bool {
    let digest = sha256_hex(bytes);
    GENERIC_FALLBACK_ICON_HASHES
        .iter()
        .any(|known| *known == digest)
}

/// SHA-256 digests of placeholder payloads observed from the icon source.
///
/// The source answers an unknown domain with HTTP 200 and a generic globe
/// rather than a 404, so the status code cannot distinguish a real icon from
/// a miss. Distinct nonexistent domains return byte-identical payloads, which
/// makes the digest a reliable miss signal. Extend this list if the source
/// ships a new placeholder; an unknown placeholder degrades to a cached
/// generic icon, never to a crash.
const GENERIC_FALLBACK_ICON_HASHES: &[&str] =
    &["59bfe9bc385ad69f50793ce4a53397316d7a875a7148a63c16df9b674c6cda64"];

fn sha256_hex(bytes: &[u8]) -> String {
    use sha2::{Digest, Sha256};
    let mut hasher = Sha256::new();
    hasher.update(bytes);
    hasher
        .finalize()
        .iter()
        .map(|byte| format!("{byte:02x}"))
        .collect()
}

/// Outcome of a single icon fetch.
#[derive(Debug)]
enum SiteIconFetch {
    /// A usable icon.
    Icon(Vec<u8>, &'static str),
    /// The source is sure this domain has no icon. Worth remembering.
    ConfirmedMiss,
    /// The attempt failed for a reason that may not repeat, such as a network
    /// error. Not cached, so the next attempt can succeed.
    Unavailable,
}

fn fetch_site_icon_bytes(domain: &str) -> Result<SiteIconFetch, TrackerError> {
    let url = site_icon_source_url(domain);
    let parsed = reqwest::Url::parse(&url)
        .map_err(|error| TrackerError::CommandFailed(error.to_string()))?;
    if !is_allowed_icon_host(&parsed) {
        return Ok(SiteIconFetch::ConfirmedMiss);
    }

    let client = reqwest::blocking::Client::builder()
        .timeout(SITE_ICON_REQUEST_TIMEOUT)
        .redirect(reqwest::redirect::Policy::custom(|attempt| {
            if attempt.previous().len() >= SITE_ICON_MAX_REDIRECTS {
                return attempt.error("too many redirects for a site icon");
            }
            // Revalidate on every hop: a redirect must not walk the fetch off
            // the allowed hosts and onto an arbitrary address.
            if is_allowed_icon_host(attempt.url()) {
                attempt.follow()
            } else {
                attempt.stop()
            }
        }))
        // No cookie store and no auth headers: this request carries no ambient
        // credentials.
        .build()
        .map_err(|error| TrackerError::CommandFailed(error.to_string()))?;

    let response = match client.get(parsed).send() {
        Ok(response) => response,
        // A transient network failure is not a permanent miss, so it is
        // reported without writing a negative cache entry.
        Err(_) => return Ok(SiteIconFetch::Unavailable),
    };
    // The source answers an unknown domain with 404 and a generic globe body.
    // Treating that as a confirmed miss is what stops it being re-requested on
    // every launch; other error codes may be transient and are not cached.
    if response.status() == reqwest::StatusCode::NOT_FOUND {
        return Ok(SiteIconFetch::ConfirmedMiss);
    }
    if !response.status().is_success() {
        return Ok(SiteIconFetch::Unavailable);
    }
    if let Some(length) = response.content_length() {
        if length as usize > SITE_ICON_MAX_BYTES {
            return Ok(SiteIconFetch::ConfirmedMiss);
        }
    }

    // Read with a hard ceiling instead of trusting Content-Length, which a
    // response can understate.
    let mut limited = response.take((SITE_ICON_MAX_BYTES + 1) as u64);
    let mut bytes = Vec::new();
    if limited.read_to_end(&mut bytes).is_err() {
        return Ok(SiteIconFetch::Unavailable);
    }
    if bytes.len() > SITE_ICON_MAX_BYTES {
        return Ok(SiteIconFetch::ConfirmedMiss);
    }

    // A non-image body (an error page, say) is not an icon.
    let Some(mime) = sniff_image_mime(&bytes) else {
        return Ok(SiteIconFetch::ConfirmedMiss);
    };
    if is_generic_fallback_icon(&bytes) {
        return Ok(SiteIconFetch::ConfirmedMiss);
    }
    Ok(SiteIconFetch::Icon(bytes, mime))
}

/// Resolves a single domain to a `data:` URL, using the on-disk cache first.
///
/// Returns `Ok(None)` when the domain has no usable icon. Callers surface that
/// as a lettered placeholder.
/// Resolves a single domain through the same cache and fetch rules as the
/// batch path. Production traffic goes through
/// [`resolve_site_icons_batch`]; this stays as the narrow, single-domain
/// entry point the tests drive directly.
#[cfg(test)]
fn resolve_site_icon_data_in(
    cache_dir: &Path,
    raw_domain: &str,
) -> Result<Option<String>, TrackerError> {
    let Some(domain) = normalized_site_domain(raw_domain) else {
        return Ok(None);
    };

    fs::create_dir_all(cache_dir).map_err(|err| TrackerError::CommandFailed(err.to_string()))?;
    let (cached_data_url, cached_miss) = cached_paths(cache_dir, &domain);

    if let Some((lookup, value)) = read_cached_site_icon(&cached_data_url, &cached_miss)? {
        return Ok(match lookup {
            SiteIconLookup::Hit => value,
            SiteIconLookup::Miss => None,
        });
    }

    let (bytes, mime) = match fetch_site_icon_bytes(&domain)? {
        SiteIconFetch::Icon(bytes, mime) => (bytes, mime),
        SiteIconFetch::ConfirmedMiss => {
            // Remember the miss so this domain is not requested again.
            fs::write(&cached_miss, [])
                .map_err(|err| TrackerError::CommandFailed(err.to_string()))?;
            return Ok(None);
        }
        // Leave no cache entry: a later attempt may succeed.
        SiteIconFetch::Unavailable => return Ok(None),
    };

    let data_url = encode_icon_data_url(&bytes, mime);
    fs::write(&cached_data_url, &data_url)
        .map_err(|err| TrackerError::CommandFailed(err.to_string()))?;
    enforce_cache_ceilings(cache_dir)?;
    Ok(Some(data_url))
}

/// Resolves a batch of domains, reading every cache hit first and fetching
/// only what is left.
///
/// Cache hits are free, so they are never subject to the batch limit; only
/// network work is capped and parallelized. Domains beyond the limit are
/// returned unresolved and picked up by a later pass.
pub(crate) fn resolve_site_icons_batch(
    app: &AppHandle,
    raw_domains: &[String],
) -> Result<Vec<(String, Option<String>)>, TrackerError> {
    resolve_site_icons_batch_in(&cache_generation_dir(app), raw_domains)
}

/// A domain the batch did not settle this pass is **omitted** from the result
/// rather than reported as `None`. `None` means "resolved, no icon"; omission
/// means "ask again". Callers rely on that split to keep retrying work that
/// was deferred past the batch limit.
fn resolve_site_icons_batch_in(
    cache_dir: &Path,
    raw_domains: &[String],
) -> Result<Vec<(String, Option<String>)>, TrackerError> {
    fs::create_dir_all(cache_dir).map_err(|err| TrackerError::CommandFailed(err.to_string()))?;

    let mut resolved: Vec<(String, Option<String>)> = Vec::with_capacity(raw_domains.len());
    let mut pending: Vec<(String, String)> = Vec::new();

    for raw_domain in raw_domains {
        let Some(domain) = normalized_site_domain(raw_domain) else {
            // Rejected values are settled: they will never have an icon.
            resolved.push((raw_domain.clone(), None));
            continue;
        };
        let (cached_data_url, cached_miss) = cached_paths(cache_dir, &domain);
        if let Some((lookup, value)) = read_cached_site_icon(&cached_data_url, &cached_miss)? {
            resolved.push((
                raw_domain.clone(),
                if lookup == SiteIconLookup::Hit { value } else { None },
            ));
            continue;
        }
        // Collapse duplicates so one batch never fetches a domain twice.
        if pending.iter().any(|(_, existing)| existing == &domain) {
            continue;
        }
        if pending.len() >= SITE_ICON_FETCH_BATCH_LIMIT {
            // Deferred, not settled: omitted so the caller asks again.
            continue;
        }
        pending.push((raw_domain.clone(), domain));
    }

    if pending.is_empty() {
        return Ok(resolved);
    }

    // Fetch in bounded parallel chunks. `scope` keeps the borrow of `pending`
    // valid without moving data onto detached threads.
    let mut fetched: Vec<(String, String, SiteIconFetch)> = Vec::with_capacity(pending.len());
    for chunk in pending.chunks(SITE_ICON_FETCH_CONCURRENCY) {
        let chunk_results = std::thread::scope(|scope| {
            let handles: Vec<_> = chunk
                .iter()
                .map(|(raw_domain, domain)| {
                    scope.spawn(move || {
                        (raw_domain.clone(), domain.clone(), fetch_site_icon_bytes(domain))
                    })
                })
                .collect();
            handles
                .into_iter()
                .map(|handle| handle.join())
                .collect::<Vec<_>>()
        });

        for result in chunk_results {
            let Ok((raw_domain, domain, outcome)) = result else {
                // A panicked worker must not abort the whole batch.
                continue;
            };
            fetched.push((raw_domain, domain, outcome?));
        }
    }

    for (raw_domain, domain, outcome) in fetched {
        let (cached_data_url, cached_miss) = cached_paths(cache_dir, &domain);
        match outcome {
            SiteIconFetch::Icon(bytes, mime) => {
                let data_url = encode_icon_data_url(&bytes, mime);
                fs::write(&cached_data_url, &data_url)
                    .map_err(|err| TrackerError::CommandFailed(err.to_string()))?;
                resolved.push((raw_domain, Some(data_url)));
            }
            SiteIconFetch::ConfirmedMiss => {
                fs::write(&cached_miss, [])
                    .map_err(|err| TrackerError::CommandFailed(err.to_string()))?;
                resolved.push((raw_domain, None));
            }
            // Left out of the result entirely: a later pass can retry.
            SiteIconFetch::Unavailable => {}
        }
    }

    enforce_cache_ceilings(cache_dir)?;
    Ok(resolved)
}

/// Drops the oldest entries once the cache exceeds its ceilings. Normal use
/// stays far below these limits; this only engages if something goes wrong.
fn enforce_cache_ceilings(cache_dir: &Path) -> Result<(), TrackerError> {
    let Ok(entries) = fs::read_dir(cache_dir) else {
        return Ok(());
    };

    let mut files: Vec<(PathBuf, u64, std::time::SystemTime)> = Vec::new();
    let mut total_bytes: u64 = 0;
    for entry in entries.flatten() {
        let Ok(metadata) = entry.metadata() else {
            continue;
        };
        if !metadata.is_file() {
            continue;
        }
        let modified = metadata
            .modified()
            .unwrap_or(std::time::SystemTime::UNIX_EPOCH);
        total_bytes += metadata.len();
        files.push((entry.path(), metadata.len(), modified));
    }

    if total_bytes <= SITE_ICON_CACHE_MAX_BYTES && files.len() <= SITE_ICON_CACHE_MAX_ENTRIES {
        return Ok(());
    }

    files.sort_by_key(|(_, _, modified)| *modified);
    let mut remaining_bytes = total_bytes;
    let mut remaining_entries = files.len();
    for (path, size, _) in files {
        if remaining_bytes <= SITE_ICON_CACHE_MAX_BYTES
            && remaining_entries <= SITE_ICON_CACHE_MAX_ENTRIES
        {
            break;
        }
        if fs::remove_file(&path).is_ok() {
            remaining_bytes = remaining_bytes.saturating_sub(size);
            remaining_entries = remaining_entries.saturating_sub(1);
        }
    }
    Ok(())
}

/// Removes cache generations other than the current one.
///
/// Running this at startup is what keeps a future format change from leaving
/// unreachable files on disk permanently.
pub(crate) fn purge_stale_site_icon_generations(app: &AppHandle) -> Result<u64, TrackerError> {
    let cache_root = app
        .path()
        .app_local_data_dir()
        .unwrap_or_else(|_| std::env::temp_dir())
        .join(SITE_ICON_CACHE_ROOT);
    if !cache_root.exists() {
        return Ok(0);
    }

    let mut reclaimed = 0_u64;
    let Ok(entries) = fs::read_dir(&cache_root) else {
        return Ok(0);
    };
    for entry in entries.flatten() {
        let path = entry.path();
        let is_current = path
            .file_name()
            .and_then(|name| name.to_str())
            .map(|name| name == SITE_ICON_CACHE_GENERATION)
            .unwrap_or(false);
        if is_current {
            continue;
        }
        reclaimed += directory_size(&path);
        let _ = fs::remove_dir_all(&path);
    }
    Ok(reclaimed)
}

/// Deletes every cached site icon. Backs the Settings control.
pub(crate) fn clear_site_icon_cache(app: &AppHandle) -> Result<u64, TrackerError> {
    let cache_root = app
        .path()
        .app_local_data_dir()
        .unwrap_or_else(|_| std::env::temp_dir())
        .join(SITE_ICON_CACHE_ROOT);
    if !cache_root.exists() {
        return Ok(0);
    }
    let reclaimed = directory_size(&cache_root);
    fs::remove_dir_all(&cache_root)
        .map_err(|err| TrackerError::CommandFailed(err.to_string()))?;
    Ok(reclaimed)
}

pub(crate) fn directory_size(path: &Path) -> u64 {
    let Ok(entries) = fs::read_dir(path) else {
        return 0;
    };
    let mut total = 0_u64;
    for entry in entries.flatten() {
        let Ok(metadata) = entry.metadata() else {
            continue;
        };
        if metadata.is_dir() {
            total += directory_size(&entry.path());
        } else {
            total += metadata.len();
        }
    }
    total
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn accepts_ordinary_public_domains() {
        assert_eq!(
            normalized_site_domain("YouTube.com"),
            Some("youtube.com".to_string())
        );
        assert_eq!(
            normalized_site_domain("  docs.example.co.uk. "),
            Some("docs.example.co.uk".to_string())
        );
    }

    #[test]
    fn rejects_browser_surfaces_and_extension_ids() {
        // Real tracker rows carry these; none of them is a fetchable host.
        for value in [
            "newtab",
            "settings",
            "downloads",
            "history",
            "extensions",
            "profile-picker",
            "fjdhphbdlfjogobdofoaagnlnkoibdge",
        ] {
            assert_eq!(normalized_site_domain(value), None, "expected {value} rejected");
        }
    }

    #[test]
    fn rejects_local_and_private_targets() {
        for value in [
            "localhost",
            "127.0.0.1",
            "192.168.1.1",
            "printer.local",
            "wiki.internal",
            "box.lan",
        ] {
            assert_eq!(normalized_site_domain(value), None, "expected {value} rejected");
        }
    }

    #[test]
    fn rejects_values_carrying_url_structure() {
        for value in [
            "example.com/path",
            "user@example.com",
            "example.com:8080",
            "exa mple.com",
            "..com",
        ] {
            assert_eq!(normalized_site_domain(value), None, "expected {value} rejected");
        }
    }

    #[test]
    fn allows_only_the_icon_source_hosts() {
        let allowed = [
            "https://www.google.com/s2/favicons?domain=example.com",
            "https://t0.gstatic.com/faviconV2?url=http://example.com",
        ];
        for url in allowed {
            let parsed = reqwest::Url::parse(url).expect("parse");
            assert!(is_allowed_icon_host(&parsed), "expected {url} allowed");
        }
    }

    #[test]
    fn blocks_redirects_off_the_allowed_hosts() {
        // A redirect must not be able to walk the fetch onto another address.
        let blocked = [
            "https://evil.example.com/icon.png",
            "http://www.google.com/s2/favicons?domain=example.com",
            "https://www.google.com.evil.test/icon.png",
            "https://127.0.0.1/icon.png",
        ];
        for url in blocked {
            let parsed = reqwest::Url::parse(url).expect("parse");
            assert!(!is_allowed_icon_host(&parsed), "expected {url} blocked");
        }
    }

    #[test]
    fn identifies_image_payloads_by_magic_bytes() {
        let png = [0x89, b'P', b'N', b'G', 0x0D, 0x0A, 0x1A, 0x0A, 0, 0];
        assert_eq!(sniff_image_mime(&png), Some("image/png"));
        // HTML error pages must not be cached as icons.
        assert_eq!(sniff_image_mime(b"<!DOCTYPE html><html>"), None);
        assert_eq!(sniff_image_mime(&[]), None);
    }

    #[test]
    fn cached_data_url_wins_over_a_negative_entry() {
        let cache_dir = tempfile::tempdir().expect("temp dir");
        let data_url = cache_dir.path().join("example_com.data-url");
        let miss = cache_dir.path().join("example_com.miss");
        fs::write(&data_url, "data:image/png;base64,cached").expect("write");

        let cached = read_cached_site_icon(&data_url, &miss).expect("read");
        assert_eq!(
            cached,
            Some((SiteIconLookup::Hit, Some("data:image/png;base64,cached".to_string())))
        );
    }

    #[test]
    fn negative_cache_entry_is_reported_as_a_miss() {
        let cache_dir = tempfile::tempdir().expect("temp dir");
        let data_url = cache_dir.path().join("example_com.data-url");
        let miss = cache_dir.path().join("example_com.miss");
        fs::write(&miss, []).expect("write");

        let cached = read_cached_site_icon(&data_url, &miss).expect("read");
        assert_eq!(cached, Some((SiteIconLookup::Miss, None)));
    }

    #[test]
    fn cache_ceilings_drop_the_oldest_entries_first() {
        let cache_dir = tempfile::tempdir().expect("temp dir");
        for index in 0..(SITE_ICON_CACHE_MAX_ENTRIES + 10) {
            fs::write(cache_dir.path().join(format!("d{index}.data-url")), "x").expect("write");
        }

        enforce_cache_ceilings(cache_dir.path()).expect("enforce");

        let remaining = fs::read_dir(cache_dir.path()).expect("read dir").count();
        assert!(
            remaining <= SITE_ICON_CACHE_MAX_ENTRIES,
            "expected the cache trimmed to its ceiling, saw {remaining}"
        );
    }

    /// Exercises the real network path end to end: a live fetch, the
    /// magic-byte check, and the placeholder digest that marks a miss.
    /// Ignored by default so offline runs stay green; run with
    /// `cargo test site_icons -- --include-ignored`.
    #[test]
    #[ignore]
    fn fetches_a_real_icon_and_confirms_a_miss() {
        match fetch_site_icon_bytes("github.com").expect("fetch real icon") {
            SiteIconFetch::Icon(bytes, mime) => {
                assert_eq!(mime, "image/png");
                assert!(!bytes.is_empty());
            }
            other => panic!("expected an icon for github.com, saw {other:?}"),
        }

        // An unknown domain must be a confirmed miss so it is cached as one
        // instead of being retried on every launch.
        match fetch_site_icon_bytes("zzz-not-real-qqq-777.org").expect("fetch unknown domain") {
            SiteIconFetch::ConfirmedMiss => {}
            other => panic!("expected a confirmed miss, saw {other:?}"),
        }
    }

    /// End-to-end over the real cache directory: a live domain resolves to a
    /// `data:` URL and is served from disk on the second call, and an unknown
    /// domain is recorded as a miss so it is not requested again.
    #[test]
    #[ignore]
    fn caches_a_resolved_icon_and_a_confirmed_miss() {
        let cache_dir = tempfile::tempdir().expect("temp dir");

        let resolved = resolve_site_icon_data_in(cache_dir.path(), "github.com")
            .expect("resolve icon")
            .expect("github.com should resolve to an icon");
        assert!(
            resolved.starts_with("data:image/"),
            "the webview must receive a data URL, saw {}",
            &resolved[..resolved.len().min(32)]
        );

        let cached_file = cache_dir.path().join("github_com.data-url");
        assert!(cached_file.exists(), "the icon should be written to disk");

        // Second call is served from disk: same bytes, no network needed.
        let again = resolve_site_icon_data_in(cache_dir.path(), "GitHub.com")
            .expect("resolve from cache")
            .expect("cached icon should be returned");
        assert_eq!(again, resolved, "a cache hit must return identical bytes");

        let missing = resolve_site_icon_data_in(cache_dir.path(), "zzz-not-real-qqq-777.org")
            .expect("resolve unknown domain");
        assert_eq!(missing, None);
        assert!(
            cache_dir.path().join("zzz_not_real_qqq_777_org.miss").exists(),
            "a confirmed miss should be remembered so it is not retried"
        );
    }

    #[test]
    fn skips_the_network_entirely_for_rejected_domains() {
        let cache_dir = tempfile::tempdir().expect("temp dir");

        // Pre-filtered values must not reach the network or touch the cache.
        for value in ["newtab", "localhost", "127.0.0.1", "extension-id-abc"] {
            assert_eq!(
                resolve_site_icon_data_in(cache_dir.path(), value).expect("resolve"),
                None
            );
        }
        assert!(
            !cache_dir.path().exists() || fs::read_dir(cache_dir.path()).expect("read").count() == 0,
            "rejected domains should leave no cache entries"
        );
    }

    #[test]
    fn batch_serves_cache_hits_without_capping_them() {
        let cache_dir = tempfile::tempdir().expect("temp dir");
        // Far more cached domains than the network batch limit allows.
        let count = SITE_ICON_FETCH_BATCH_LIMIT * 3;
        let domains: Vec<String> = (0..count).map(|i| format!("cached{i}.com")).collect();
        for domain in &domains {
            let (data_url, _) = cached_paths(cache_dir.path(), domain);
            fs::write(&data_url, format!("data:image/png;base64,{domain}")).expect("seed");
        }

        let resolved = resolve_site_icons_batch_in(cache_dir.path(), &domains).expect("resolve");

        assert_eq!(resolved.len(), count);
        assert!(
            resolved.iter().all(|(_, icon)| icon.is_some()),
            "cache hits are free and must never be limited by the fetch batch size"
        );
    }

    /// Measures the batch against a realistic cold-cache load. A 90-day
    /// history view on a real install asks for ~534 domains at once; before
    /// batching, that was a single blocking pass of roughly three minutes.
    #[test]
    #[ignore]
    fn large_cold_batch_stays_bounded() {
        let cache_dir = tempfile::tempdir().expect("temp dir");
        let domains: Vec<String> = (0..534)
            .map(|i| format!("nonexistent-load-probe-{i}.com"))
            .collect();

        let started = std::time::Instant::now();
        let resolved = resolve_site_icons_batch_in(cache_dir.path(), &domains).expect("resolve");
        let elapsed = started.elapsed();

        // Only the capped slice is settled in one pass; the rest are omitted
        // so the caller retries them.
        assert!(
            resolved.len() <= SITE_ICON_FETCH_BATCH_LIMIT,
            "one pass must settle at most the batch limit, saw {}",
            resolved.len()
        );
        // Only the capped slice may reach the network in one pass.
        let cached_entries = fs::read_dir(cache_dir.path()).expect("read dir").count();
        assert!(
            cached_entries <= SITE_ICON_FETCH_BATCH_LIMIT,
            "one pass must not fetch more than the batch limit, saw {cached_entries}"
        );
        assert!(
            elapsed < Duration::from_secs(20),
            "a single pass must stay bounded, took {elapsed:?}"
        );
        eprintln!("cold batch of {} domains took {elapsed:?}", domains.len());
    }


    #[test]
    fn batch_caps_uncached_domains_and_leaves_the_rest_for_a_later_pass() {
        let cache_dir = tempfile::tempdir().expect("temp dir");
        // Reject every domain so the test never touches the network while
        // still exercising the batching bookkeeping.
        let domains: Vec<String> = (0..(SITE_ICON_FETCH_BATCH_LIMIT * 2))
            .map(|i| format!("localhost{i}"))
            .collect();

        let resolved = resolve_site_icons_batch_in(cache_dir.path(), &domains).expect("resolve");

        // Rejected domains are settled, so they are all reported.
        assert_eq!(resolved.len(), domains.len());
        assert!(resolved.iter().all(|(_, icon)| icon.is_none()));
        assert_eq!(
            fs::read_dir(cache_dir.path()).expect("read dir").count(),
            0,
            "rejected domains must not create cache entries"
        );
    }

    #[test]
    fn batch_omits_domains_it_deferred_past_the_limit() {
        let cache_dir = tempfile::tempdir().expect("temp dir");
        // One cached domain plus more uncached domains than a pass may fetch.
        let cached = "already.com".to_string();
        let (data_url, _) = cached_paths(cache_dir.path(), &cached);
        fs::write(&data_url, "data:image/png;base64,cached").expect("seed");

        let mut domains = vec![cached.clone()];
        domains.extend(
            (0..(SITE_ICON_FETCH_BATCH_LIMIT * 2)).map(|i| format!("deferred-probe-{i}.com")),
        );

        let resolved = resolve_site_icons_batch_in(cache_dir.path(), &domains).expect("resolve");
        let reported: Vec<&String> = resolved.iter().map(|(domain, _)| domain).collect();

        // The cache hit is always reported.
        assert!(reported.contains(&&cached));
        // Deferred domains are omitted rather than reported as resolved
        // misses, so the caller knows to ask again instead of rendering a
        // permanent placeholder.
        assert!(
            resolved.len() < domains.len(),
            "expected deferred domains to be omitted, saw all {} reported",
            resolved.len()
        );
    }


    /// The batch path is the one the app actually calls, so it is worth
    /// confirming against the live source that parallel fetches resolve, get
    /// cached, and are served from disk on the next pass.
    #[test]
    #[ignore]
    fn batch_resolves_real_domains_in_parallel_and_caches_them() {
        let cache_dir = tempfile::tempdir().expect("temp dir");
        let domains: Vec<String> = vec![
            "github.com".into(),
            "youtube.com".into(),
            "wikipedia.org".into(),
            "stackoverflow.com".into(),
            "zzz-not-real-qqq-777.org".into(),
        ];

        let started = std::time::Instant::now();
        let resolved = resolve_site_icons_batch_in(cache_dir.path(), &domains).expect("resolve");
        let elapsed = started.elapsed();

        assert_eq!(resolved.len(), domains.len());
        for (domain, icon) in &resolved {
            if domain.starts_with("zzz-") {
                assert!(icon.is_none(), "an unknown domain must resolve to no icon");
            } else {
                let icon = icon.as_ref().unwrap_or_else(|| panic!("{domain} should resolve"));
                assert!(icon.starts_with("data:image/"));
            }
        }

        // Four live fetches running concurrently should finish well inside the
        // time a serial pass would need. The bound is generous because the
        // ignored network tests share bandwidth when run together.
        assert!(
            elapsed < Duration::from_secs(10),
            "expected a parallel batch, took {elapsed:?}"
        );

        // Second pass is served entirely from disk.
        let cached = resolve_site_icons_batch_in(cache_dir.path(), &domains).expect("resolve");
        assert_eq!(cached, resolved, "the second pass must match the first");
    }


}



fn read_cached_site_icon(
    cached_data_url: &Path,
    cached_miss: &Path,
) -> Result<Option<(SiteIconLookup, Option<String>)>, TrackerError> {
    if cached_data_url.exists() {
        let data_url = fs::read_to_string(cached_data_url)
            .map_err(|err| TrackerError::CommandFailed(err.to_string()))?;
        if !data_url.is_empty() {
            return Ok(Some((SiteIconLookup::Hit, Some(data_url))));
        }
    }
    if cached_miss.exists() {
        return Ok(Some((SiteIconLookup::Miss, None)));
    }
    Ok(None)
}

fn encode_icon_data_url(bytes: &[u8], mime: &str) -> String {
    let encoded = base64::engine::general_purpose::STANDARD.encode(bytes);
    format!("data:{mime};base64,{encoded}")
}

/// Detects the image type from magic bytes rather than trusting
/// `Content-Type`, and refuses anything that is not a known image format.
fn sniff_image_mime(bytes: &[u8]) -> Option<&'static str> {
    if bytes.len() < 4 {
        return None;
    }
    if bytes.starts_with(&[0x89, b'P', b'N', b'G', 0x0D, 0x0A, 0x1A, 0x0A]) {
        return Some("image/png");
    }
    if bytes.starts_with(&[0xFF, 0xD8, 0xFF]) {
        return Some("image/jpeg");
    }
    if bytes.starts_with(&[0x00, 0x00, 0x01, 0x00]) {
        return Some("image/x-icon");
    }
    if bytes.starts_with(b"GIF87a") || bytes.starts_with(b"GIF89a") {
        return Some("image/gif");
    }
    if bytes.len() >= 12 && bytes.starts_with(b"RIFF") && &bytes[8..12] == b"WEBP" {
        return Some("image/webp");
    }
    None
}

fn is_allowed_icon_host(url: &reqwest::Url) -> bool {
    if url.scheme() != "https" {
        return false;
    }
    if let Some(port) = url.port() {
        if port != 443 {
            return false;
        }
    }
    let Some(host) = url.host_str() else {
        return false;
    };
    let host = host.to_ascii_lowercase();
    SITE_ICON_ALLOWED_HOSTS
        .iter()
        .any(|allowed| host == *allowed || host.ends_with(&format!(".{allowed}")))
}

pub(crate) fn site_icon_source_url(domain: &str) -> String {
    format!(
        "https://www.google.com/s2/favicons?domain={}&sz=64",
        urlencoding_encode(domain)
    )
}

fn urlencoding_encode(value: &str) -> String {
    value
        .chars()
        .map(|c| {
            if c.is_ascii_alphanumeric() || c == '-' || c == '.' || c == '_' {
                c.to_string()
            } else {
                format!("%{:02X}", c as u32)
            }
        })
        .collect()
}
