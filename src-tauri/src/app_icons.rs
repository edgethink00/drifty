use base64::Engine;
#[cfg(target_os = "macos")]
use objc2::rc::autoreleasepool;
#[cfg(target_os = "macos")]
use objc2::AnyThread;
#[cfg(target_os = "macos")]
use objc2_app_kit::{NSBitmapImageFileType, NSBitmapImageRep, NSWorkspace};
#[cfg(target_os = "macos")]
use objc2_foundation::{NSData, NSDictionary, NSString};
use std::fs;
use std::path::{Path, PathBuf};

use tauri::{AppHandle, Manager};

use crate::tracker::{AppIdentity, TrackerError};

const APP_ICON_CACHE_DIR: &str = "icon-cache";
const APP_ICON_DATA_URL_EXTENSION: &str = "data-url";
const APP_ICON_PNG_EXTENSION: &str = "png";

pub(crate) fn app_identity_key(identity: &AppIdentity) -> String {
    identity
        .bundle_id
        .clone()
        .filter(|value| !value.is_empty())
        .unwrap_or_else(|| identity.app_name.clone())
}

pub(crate) fn resolve_app_icon_data(
    app: &AppHandle,
    identity: &AppIdentity,
) -> Result<Option<String>, TrackerError> {
    let cache_root = app
        .path()
        .app_local_data_dir()
        .unwrap_or_else(|_| std::env::temp_dir())
        .join(APP_ICON_CACHE_DIR);
    fs::create_dir_all(&cache_root).map_err(|err| TrackerError::CommandFailed(err.to_string()))?;

    let cache_key = sanitize_filename(&app_identity_key(identity));
    let cached_data_url = cache_root.join(format!("{cache_key}.{APP_ICON_DATA_URL_EXTENSION}"));
    let cached_png = cache_root.join(format!("{cache_key}.{APP_ICON_PNG_EXTENSION}"));

    if let Some(cached_icon) = read_cached_app_icon_data_url(&cached_data_url, &cached_png)? {
        return Ok(Some(cached_icon));
    }

    let app_path = resolve_application_path(identity)?;
    if app_path.as_os_str().is_empty() {
        return Ok(None);
    }

    let Some(icon_bytes) = resolve_native_app_icon_png(&app_path)? else {
        return Ok(None);
    };
    fs::write(&cached_png, &icon_bytes)
        .map_err(|err| TrackerError::CommandFailed(err.to_string()))?;
    let data_url = encode_icon_data_url(&icon_bytes);
    fs::write(&cached_data_url, &data_url)
        .map_err(|err| TrackerError::CommandFailed(err.to_string()))?;
    Ok(Some(data_url))
}

fn read_cached_app_icon_data_url(
    cached_data_url: &Path,
    cached_png: &Path,
) -> Result<Option<String>, TrackerError> {
    if cached_data_url.exists() {
        let data_url = fs::read_to_string(cached_data_url)
            .map_err(|err| TrackerError::CommandFailed(err.to_string()))?;
        if !data_url.is_empty() {
            return Ok(Some(data_url));
        }
    }

    if !cached_png.exists() {
        return Ok(None);
    }

    let bytes = fs::read(cached_png).map_err(|err| TrackerError::CommandFailed(err.to_string()))?;
    let data_url = encode_icon_data_url(&bytes);
    fs::write(cached_data_url, &data_url)
        .map_err(|err| TrackerError::CommandFailed(err.to_string()))?;
    Ok(Some(data_url))
}

fn encode_icon_data_url(bytes: &[u8]) -> String {
    let encoded = base64::engine::general_purpose::STANDARD.encode(bytes);
    format!("data:image/png;base64,{encoded}")
}

#[cfg(target_os = "macos")]
fn resolve_native_app_icon_png(app_path: &Path) -> Result<Option<Vec<u8>>, TrackerError> {
    // SAFETY: Category 8 - FFI boundary. objc2 AppKit/Foundation wrappers own the
    // Objective-C objects for this autorelease scope, every nullable return is
    // checked before use, and no raw Objective-C pointer escapes this function.
    autoreleasepool(|_| unsafe {
        let workspace = NSWorkspace::sharedWorkspace();
        let path = NSString::from_str(app_path.to_string_lossy().as_ref());
        let icon = workspace.iconForFile(&path);

        let Some(tiff_data) = icon.TIFFRepresentation() else {
            return Ok(None);
        };
        let Some(image_rep) = NSBitmapImageRep::initWithData(NSBitmapImageRep::alloc(), &tiff_data)
        else {
            return Ok(None);
        };
        let properties = NSDictionary::new();
        let Some(png_data) =
            image_rep.representationUsingType_properties(NSBitmapImageFileType::PNG, &properties)
        else {
            return Ok(None);
        };

        Ok(Some(NSData::to_vec(&png_data)))
    })
}

#[cfg(not(target_os = "macos"))]
fn resolve_native_app_icon_png(_app_path: &Path) -> Result<Option<Vec<u8>>, TrackerError> {
    Ok(None)
}

fn resolve_application_path(identity: &AppIdentity) -> Result<PathBuf, TrackerError> {
    #[cfg(target_os = "macos")]
    {
        let resolved_from_bundle = autoreleasepool(|pool| {
            // SAFETY: Category 8 - FFI boundary. The bundle id NSString is built
            // from a Rust &str and each nullable AppKit/Foundation return is
            // checked before converting it into an owned PathBuf.
            unsafe {
                let workspace = NSWorkspace::sharedWorkspace();
                if let Some(bundle_id) = identity
                    .bundle_id
                    .as_ref()
                    .filter(|value| !value.is_empty())
                {
                    let bundle_identifier = NSString::from_str(bundle_id);
                    if let Some(bundle_url) =
                        workspace.URLForApplicationWithBundleIdentifier(&bundle_identifier)
                    {
                        if let Some(path) = bundle_url.path() {
                            let path_string = path.to_str(pool).to_owned();
                            if !path_string.is_empty() {
                                return Some(PathBuf::from(path_string));
                            }
                        }
                    }
                }
                None
            }
        });

        if let Some(path) = resolved_from_bundle {
            return Ok(path);
        }

        let resolved_from_name = autoreleasepool(|pool| {
            // SAFETY: Category 8 - FFI boundary. The app name NSString is built
            // from a Rust &str and the deprecated AppKit lookup returns an
            // optional NSString that is checked before ownership conversion.
            unsafe {
                let workspace = NSWorkspace::sharedWorkspace();
                let app_name = NSString::from_str(&identity.app_name);
                #[allow(deprecated)]
                let app_path = workspace.fullPathForApplication(&app_name);
                let Some(app_path) = app_path else {
                    return None;
                };
                let path_string = app_path.to_str(pool).to_owned();
                if path_string.is_empty() {
                    None
                } else {
                    Some(PathBuf::from(path_string))
                }
            }
        });

        if let Some(path) = resolved_from_name {
            return Ok(path);
        }
    }

    Ok(PathBuf::new())
}

fn sanitize_filename(input: &str) -> String {
    input
        .chars()
        .map(|char| {
            if char.is_ascii_alphanumeric() {
                char
            } else {
                '_'
            }
        })
        .collect()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn cached_data_url_is_reused_when_present() {
        // Given: both cache formats exist and the data URL cache is already populated.
        let cache_dir = tempfile::tempdir().expect("temp dir");
        let cached_data_url = cache_dir.path().join("Code.data-url");
        let cached_png = cache_dir.path().join("Code.png");
        fs::write(&cached_data_url, "data:image/png;base64,cached").expect("write data url");
        fs::write(&cached_png, [1_u8, 2, 3]).expect("write png");

        // When: the icon is read from cache.
        let icon =
            read_cached_app_icon_data_url(&cached_data_url, &cached_png).expect("read cache");

        // Then: the data URL cache wins over the older PNG cache.
        assert_eq!(icon, Some("data:image/png;base64,cached".to_string()));
    }

    #[test]
    fn cached_png_is_promoted_to_data_url() {
        // Given: an older PNG cache exists without the data URL cache.
        let cache_dir = tempfile::tempdir().expect("temp dir");
        let cached_data_url = cache_dir.path().join("Code.data-url");
        let cached_png = cache_dir.path().join("Code.png");
        fs::write(&cached_png, [1_u8, 2, 3]).expect("write png");

        // When: the icon is read from cache.
        let icon =
            read_cached_app_icon_data_url(&cached_data_url, &cached_png).expect("read cache");

        // Then: the PNG bytes are encoded once and persisted as the fast cache.
        assert_eq!(icon, Some("data:image/png;base64,AQID".to_string()));
        let persisted = fs::read_to_string(cached_data_url).expect("read data url");
        assert_eq!(persisted, "data:image/png;base64,AQID");
    }

    #[test]
    fn missing_cache_returns_none() {
        // Given: no data URL or PNG cache exists.
        let cache_dir = tempfile::tempdir().expect("temp dir");
        let cached_data_url = cache_dir.path().join("Code.data-url");
        let cached_png = cache_dir.path().join("Code.png");

        // When: the icon is read from cache.
        let icon =
            read_cached_app_icon_data_url(&cached_data_url, &cached_png).expect("read cache");

        // Then: the caller can continue to native app resolution.
        assert_eq!(icon, None);
    }
}
