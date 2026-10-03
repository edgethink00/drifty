use base64::Engine;
#[cfg(target_os = "macos")]
use objc2::rc::autoreleasepool;
#[cfg(target_os = "macos")]
use objc2::AnyThread;
#[cfg(target_os = "macos")]
use objc2_app_kit::{
    NSBitmapImageFileType, NSBitmapImageRep, NSDeviceRGBColorSpace, NSGraphicsContext,
    NSImageInterpolation, NSWorkspace,
};
#[cfg(target_os = "macos")]
use objc2_foundation::{NSData, NSDictionary, NSPoint, NSRect, NSSize, NSString};
use std::fs;
use std::path::{Path, PathBuf};

use tauri::{AppHandle, Manager};

use crate::tracker::{AppIdentity, TrackerError};

#[cfg(any(target_os = "windows", test))]
mod png;
#[cfg(target_os = "windows")]
mod windows;
#[cfg(any(target_os = "windows", test))]
use png::encode_png_rgba;
#[cfg(test)]
use png::{adler32, crc32};

#[cfg(any(target_os = "windows", test))]
use quick_xml::events::Event;
#[cfg(any(target_os = "windows", test))]
use quick_xml::Reader;

const APP_ICON_CACHE_DIR: &str = "icon-cache";
const APP_ICON_CACHE_VARIANT: &str = "128";
const APP_ICON_DATA_URL_EXTENSION: &str = "data-url";
const APP_ICON_PNG_EXTENSION: &str = "png";
const APP_ICON_TARGET_PX: u32 = 128;

const PNG_SIGNATURE: [u8; 8] = *b"\x89PNG\r\n\x1a\n";

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
    let (cached_data_url, cached_png) = cached_icon_paths(&cache_root, &cache_key);

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

fn cached_icon_paths(cache_root: &Path, cache_key: &str) -> (PathBuf, PathBuf) {
    let thumbnail_key = format!("{cache_key}.{APP_ICON_CACHE_VARIANT}");
    (
        cache_root.join(format!("{thumbnail_key}.{APP_ICON_DATA_URL_EXTENSION}")),
        cache_root.join(format!("{thumbnail_key}.{APP_ICON_PNG_EXTENSION}")),
    )
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
    // Objective-C objects for this autorelease scope. NSBitmapImageRep allocates
    // its own backing store when passed null planes, every nullable return is
    // checked before use, and no raw Objective-C pointer escapes this function.
    autoreleasepool(|_| unsafe {
        let workspace = NSWorkspace::sharedWorkspace();
        let path = NSString::from_str(app_path.to_string_lossy().as_ref());
        let icon = workspace.iconForFile(&path);

        let target_pixels = APP_ICON_TARGET_PX as isize;
        let target_length = f64::from(APP_ICON_TARGET_PX);
        let target_size = NSSize::new(target_length, target_length);
        let target_rect = NSRect::new(NSPoint::new(0.0, 0.0), target_size);
        let Some(bitmap_rep) = NSBitmapImageRep::initWithBitmapDataPlanes_pixelsWide_pixelsHigh_bitsPerSample_samplesPerPixel_hasAlpha_isPlanar_colorSpaceName_bytesPerRow_bitsPerPixel(
            NSBitmapImageRep::alloc(),
            std::ptr::null_mut(),
            target_pixels,
            target_pixels,
            8,
            4,
            true,
            false,
            NSDeviceRGBColorSpace,
            0,
            0,
        ) else {
            return Ok(None);
        };
        let Some(context) = NSGraphicsContext::graphicsContextWithBitmapImageRep(&bitmap_rep)
        else {
            return Ok(None);
        };

        context.setImageInterpolation(NSImageInterpolation::High);
        NSGraphicsContext::saveGraphicsState_class();
        NSGraphicsContext::setCurrentContext(Some(&context));
        icon.drawInRect(target_rect);
        NSGraphicsContext::restoreGraphicsState_class();

        let properties = NSDictionary::new();
        let Some(png_data) =
            bitmap_rep.representationUsingType_properties(NSBitmapImageFileType::PNG, &properties)
        else {
            return Ok(None);
        };

        Ok(Some(NSData::to_vec(&png_data)))
    })
}

#[cfg(target_os = "windows")]
fn resolve_native_app_icon_png(app_path: &Path) -> Result<Option<Vec<u8>>, TrackerError> {
    windows::resolve_windows_app_icon_png(app_path)
}

#[cfg(not(any(target_os = "macos", target_os = "windows")))]
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

    #[cfg(target_os = "windows")]
    {
        // Windows rows store the lowercased executable path in bundle_id, or
        // the AUMID (PackageFamilyName!AppId) for packaged apps
        // (windows_workspace.py identity model). An executable resolves
        // directly; an AUMID resolves to the logo PNG inside the package's
        // install directory, which resolve_native_app_icon_png reads
        // straight off disk.
        if let Some(bundle_id) = identity
            .bundle_id
            .as_deref()
            .map(str::trim)
            .filter(|value| !value.is_empty())
        {
            if let Some(exe_path) = windows::executable_path(bundle_id) {
                return Ok(exe_path);
            }
            if let Some(logo_path) = windows::packaged_app_logo_path(bundle_id) {
                return Ok(logo_path);
            }
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

fn app_icon_cache_root(app: &AppHandle) -> PathBuf {
    app.path()
        .app_local_data_dir()
        .unwrap_or_else(|_| std::env::temp_dir())
        .join(APP_ICON_CACHE_DIR)
}

/// Removes cache entries written before the `.128.` variant key existed.
///
/// Those files store pre-resize, full-resolution icons and nothing reads them
/// anymore, but no cleanup shipped with the key change. Long-running installs
/// accumulate hundreds of megabytes this way (195MB observed on a real
/// machine), so this reclaims them once at startup.
pub(crate) fn purge_legacy_app_icon_cache(app: &AppHandle) -> Result<u64, TrackerError> {
    purge_legacy_entries_in(&app_icon_cache_root(app))
}

/// Directory-explicit form of [`purge_legacy_app_icon_cache`] so the retention
/// rule can be tested without touching the real cache.
fn purge_legacy_entries_in(cache_root: &Path) -> Result<u64, TrackerError> {
    if !cache_root.exists() {
        return Ok(0);
    }

    let current_marker = format!(".{APP_ICON_CACHE_VARIANT}.");
    let Ok(entries) = fs::read_dir(cache_root) else {
        return Ok(0);
    };

    let mut reclaimed = 0_u64;
    for entry in entries.flatten() {
        let Ok(metadata) = entry.metadata() else {
            continue;
        };
        if !metadata.is_file() {
            continue;
        }
        let Some(name) = entry.file_name().to_str().map(str::to_owned) else {
            continue;
        };
        // Keep anything written in the current variant format.
        if name.contains(&current_marker) {
            continue;
        }
        let size = metadata.len();
        if fs::remove_file(entry.path()).is_ok() {
            reclaimed += size;
        }
    }
    Ok(reclaimed)
}

/// Deletes every cached app icon. Backs the Settings control.
pub(crate) fn clear_app_icon_cache(app: &AppHandle) -> Result<u64, TrackerError> {
    let cache_root = app_icon_cache_root(app);
    if !cache_root.exists() {
        return Ok(0);
    }
    let reclaimed = crate::site_icons::directory_size(&cache_root);
    fs::remove_dir_all(&cache_root).map_err(|err| TrackerError::CommandFailed(err.to_string()))?;
    Ok(reclaimed)
}

// ---------------------------------------------------------------------------
// Windows helpers shared with the app_icons::windows module. They are pure
// (no Win32 calls) so the unit tests can exercise them on any platform; the
// windows-only gate keeps them out of other builds.
// ---------------------------------------------------------------------------

/// Whether a bundle_id value is an absolute Windows path rather than an
/// AUMID or an app name.
#[cfg(any(target_os = "windows", test))]
fn is_windows_absolute_path(value: &str) -> bool {
    let bytes = value.as_bytes();
    let drive_absolute = bytes.len() >= 3
        && bytes[0].is_ascii_alphabetic()
        && bytes[1] == b':'
        && (bytes[2] == b'\\' || bytes[2] == b'/');
    drive_absolute || value.starts_with("\\\\")
}

/// Extracts the package family from an AUMID ("Family!AppId"), or returns
/// None when the value is not an AUMID.
#[cfg(test)]
fn package_family_from_aumid(aumid: &str) -> Option<&str> {
    package_identity_from_aumid(aumid).map(|(family, _app)| family)
}

/// Splits an AUMID into its package family and package-relative application ID.
#[cfg(any(target_os = "windows", test))]
fn package_identity_from_aumid(aumid: &str) -> Option<(&str, &str)> {
    let (family, app_id) = aumid.split_once('!')?;
    if family.is_empty()
        || !family
            .chars()
            .all(|c| c.is_ascii_alphanumeric() || c == '.' || c == '_' || c == '-')
        || app_id.is_empty()
        || app_id.contains('!')
    {
        return None;
    }
    Some((family, app_id))
}

/// Collects the selected application's logo references from an AppxManifest.xml body.
///
/// Visual-element attributes are scoped to the `<Application>` whose `Id`
/// matches the AUMID. The package-level `<Properties><Logo>` remains a fallback.
#[cfg(any(target_os = "windows", test))]
fn manifest_logo_candidates(manifest: &str, app_id: &str) -> Vec<String> {
    const MAX_VALUE_LEN: usize = 512;

    // Lower rank is preferred. These attributes belong to the selected
    // Application's VisualElements or DefaultTile elements.
    fn attribute_rank(name: &str) -> Option<u8> {
        match name {
            "Square150x150Logo" => Some(0),
            "Square310x310Logo" => Some(1),
            "Square44x44Logo" | "Square30x30Logo" | "Square70x70Logo" | "Square71x71Logo" => {
                Some(2)
            }
            "Wide310x150Logo" => Some(3),
            "StoreLogo" => Some(4),
            _ => None,
        }
    }

    fn collect_logo_attributes(
        element: &quick_xml::events::BytesStart<'_>,
        decoder: quick_xml::encoding::Decoder,
        ranked: &mut Vec<(u8, String)>,
    ) {
        for attribute in element.attributes().flatten() {
            let name = String::from_utf8_lossy(attribute.key.local_name().as_ref()).into_owned();
            let Some(rank) = attribute_rank(&name) else {
                continue;
            };
            let Ok(value) = attribute.decode_and_unescape_value(decoder) else {
                continue;
            };
            let value = value.trim();
            if value.is_empty() || value.len() > MAX_VALUE_LEN || value.starts_with("http") {
                continue;
            }
            ranked.push((rank, value.to_string()));
        }
    }

    let mut ranked: Vec<(u8, String)> = Vec::new();
    let mut reader = Reader::from_str(manifest);
    reader.config_mut().trim_text(true);
    let mut depth = 0usize;
    let mut selected_application_depth = None;
    let mut properties_depth = None;
    let mut package_logo_depth = None;
    let mut package_logo = String::new();

    loop {
        match reader.read_event() {
            Ok(Event::Start(element)) => {
                let local = element.local_name();
                if local.as_ref() == b"Application" {
                    let matches_app = element.attributes().flatten().any(|attribute| {
                        attribute.key.local_name().as_ref() == b"Id"
                            && attribute
                                .decode_and_unescape_value(reader.decoder())
                                .is_ok_and(|id| id.eq_ignore_ascii_case(app_id))
                    });
                    if matches_app && selected_application_depth.is_none() {
                        selected_application_depth = Some(depth);
                    }
                } else if selected_application_depth.is_some()
                    && matches!(local.as_ref(), b"VisualElements" | b"DefaultTile")
                {
                    collect_logo_attributes(&element, reader.decoder(), &mut ranked);
                }

                if local.as_ref() == b"Properties" {
                    properties_depth = Some(depth);
                } else if local.as_ref() == b"Logo" && properties_depth.is_some() {
                    package_logo_depth = Some(depth);
                }
                depth += 1;
            }
            Ok(Event::Empty(element)) => {
                let local = element.local_name();
                if selected_application_depth.is_some()
                    && matches!(local.as_ref(), b"VisualElements" | b"DefaultTile")
                {
                    collect_logo_attributes(&element, reader.decoder(), &mut ranked);
                }
            }
            Ok(Event::Text(text)) if package_logo_depth.is_some() => {
                if let Ok(decoded) = text.decode() {
                    if let Ok(unescaped) = quick_xml::escape::unescape(&decoded) {
                        package_logo.push_str(unescaped.trim());
                    }
                }
            }
            Ok(Event::End(element)) => {
                depth = depth.saturating_sub(1);
                let local = element.local_name();
                if local.as_ref() == b"Application" && selected_application_depth == Some(depth) {
                    selected_application_depth = None;
                }
                if local.as_ref() == b"Logo" && package_logo_depth == Some(depth) {
                    package_logo_depth = None;
                }
                if local.as_ref() == b"Properties" && properties_depth == Some(depth) {
                    properties_depth = None;
                }
            }
            Ok(Event::Eof) => break,
            Err(_) => return Vec::new(),
            _ => {}
        }
    }

    if !package_logo.is_empty()
        && package_logo.len() <= MAX_VALUE_LEN
        && !package_logo.starts_with("http")
    {
        ranked.push((5, package_logo));
    }

    ranked.sort_by_key(|(rank, _)| *rank);
    let mut seen = std::collections::HashSet::new();
    ranked
        .into_iter()
        .map(|(_, value)| value)
        .filter(|value| seen.insert(value.clone()))
        .collect()
}

/// Scores a file as a candidate for a manifest logo reference like
/// "Assets/logo.png". Windows ships variants ("logo.scale-200.png",
/// "logo.targetsize-256.png") next to the base name; the score prefers a real
/// pixel size at or above the cache's 128px target, then a higher scale
/// factor.
///
/// Returns None when filename is not a variant of "stem.ext".
#[cfg(any(target_os = "windows", test))]
fn logo_variant_score(stem: &str, ext: &str, filename: &str) -> Option<u64> {
    let (name, file_ext) = filename.rsplit_once('.')?;
    if !file_ext.eq_ignore_ascii_case(ext) {
        return None;
    }
    // NTFS lookups are case-insensitive, so a manifest stem like "Logo" can
    // match files written as "logo.scale-200.png".
    let suffix = name
        .get(..stem.len())
        .filter(|head| head.eq_ignore_ascii_case(stem))
        .map(|_| &name[stem.len()..])?;
    if suffix.is_empty() {
        return Some(0);
    }
    if !suffix.starts_with('.') {
        return None;
    }
    // Variants look like ".scale-200", ".targetsize-256", ".altform-unplated",
    // or a combination. Qualifiers are separated by '.' in filenames and by
    // '_' when several share one folder name ("scale-200_contrast-black").
    let mut target_size: Option<u64> = None;
    let mut scale: Option<u64> = None;
    // 3 = no theme, 2 = light, 1 = dark/other. A theme marker must not hide
    // the logo, and it must not outrank the same asset without one.
    let mut theme_rank: u64 = 3;
    for token in suffix.split(|c| c == '.' || c == '_') {
        let token = token.to_ascii_lowercase();
        if token.is_empty() {
            continue;
        }
        if let Some(rest) = token.strip_prefix("scale-") {
            scale = rest.parse().ok();
        } else if let Some(rest) = token.strip_prefix("targetsize-") {
            target_size = rest.parse().ok();
        } else if token == "theme-light" {
            theme_rank = 2;
        } else if token.starts_with("theme-") {
            theme_rank = 1;
        } else if token.starts_with("contrast-") || token.starts_with("altform-") {
            // Accessibility/plating variants are still the app's logo.
        } else {
            return None;
        }
    }
    if target_size.is_none() && scale.is_none() {
        return None;
    }
    // A declared pixel size at or above the 128px target wins outright.
    // Otherwise rank by scale factor; a below-target pixel size and the bare
    // file still act as fallbacks rather than being skipped.
    if let Some(size) = target_size.filter(|size| *size >= APP_ICON_TARGET_PX as u64) {
        return Some(2_000_000 + size.min(4096) + theme_rank);
    }
    Some(1_000_000 + scale.unwrap_or(0) + target_size.unwrap_or(0).min(999) + theme_rank)
}

/// Normalizes a manifest logo path while keeping it relative to the package
/// install directory. A manifest must not redirect icon lookup to an arbitrary
/// drive, UNC share, rooted path, alternate data stream, or parent directory.
#[cfg(any(target_os = "windows", test))]
fn normalize_packaged_logo_reference(reference: &str) -> Option<String> {
    let mut relative = reference.trim().replace('/', "\\");
    if relative.is_empty()
        || relative.starts_with('\\')
        || relative.contains(':')
        || relative.split('\\').any(|part| part == "..")
    {
        return None;
    }

    while let Some(rest) = relative.strip_prefix(".\\") {
        relative = rest.to_string();
    }
    (!relative.is_empty()).then_some(relative)
}

/// Score for a resource-qualifier directory such as "scale-200" or
/// "scale-200_contrast-black" sitting next to the base logo name.
#[cfg(any(target_os = "windows", test))]
fn packaged_logo_qualifier_score(directory_name: &str, stem: &str, ext: &str) -> Option<u64> {
    if directory_name.is_empty() || directory_name.contains(['/', '\\', '.']) {
        return None;
    }
    logo_variant_score(stem, ext, &format!("{stem}.{directory_name}.{ext}"))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn windows_absolute_paths_are_recognized() {
        for value in [
            "c:\\program files\\google\\chrome\\application\\chrome.exe",
            "D:/Tools/app.exe",
            "\\\\server\\share\\app.exe",
        ] {
            assert!(is_windows_absolute_path(value), "expected {value} accepted");
        }
        for value in [
            "Microsoft.WindowsCalculator_8wekyb3d8bbwe!App",
            "Code",
            "app.exe",
            "relative\\app.exe",
        ] {
            assert!(
                !is_windows_absolute_path(value),
                "expected {value} rejected"
            );
        }
    }

    #[test]
    fn aumid_yields_its_package_family() {
        assert_eq!(
            package_family_from_aumid("Microsoft.WindowsCalculator_8wekyb3d8bbwe!App"),
            Some("Microsoft.WindowsCalculator_8wekyb3d8bbwe")
        );
        assert_eq!(
            package_identity_from_aumid("Microsoft.WindowsCalculator_8wekyb3d8bbwe!App"),
            Some(("Microsoft.WindowsCalculator_8wekyb3d8bbwe", "App"))
        );
        assert_eq!(package_family_from_aumid("c:\\app\\app.exe"), None);
        assert_eq!(package_family_from_aumid("no-bang-here"), None);
        assert_eq!(package_family_from_aumid("!App"), None);
        assert_eq!(package_family_from_aumid("Family!"), None);
        assert_eq!(package_family_from_aumid("Family!App!Extra"), None);
        assert_eq!(package_family_from_aumid("not a family!App"), None);
    }

    #[test]
    fn manifest_logo_candidates_prefer_square_tiles() {
        let manifest = concat!(
            "<Package xmlns:uap=\"http://schemas.microsoft.com/appx/manifest/uap/windows10\">",
            "<Properties><Logo>Assets\\StoreLogo.png</Logo></Properties>",
            "<Applications><Application Id=\"App\"><uap:VisualElements ",
            "Square44x44Logo=\"Assets\\Square44.png\" ",
            "Square150x150Logo=\"Assets\\Square150.png\">",
            "<uap:DefaultTile Wide310x150Logo='Assets\\Wide.png'/>",
            "</uap:VisualElements></Application></Applications></Package>",
        );
        assert_eq!(
            manifest_logo_candidates(manifest, "App"),
            vec![
                "Assets\\Square150.png",
                "Assets\\Square44.png",
                "Assets\\Wide.png",
                "Assets\\StoreLogo.png",
            ]
        );
    }

    #[test]
    fn manifest_logo_candidates_are_scoped_to_the_aumid_application() {
        let manifest = concat!(
            "<Package xmlns:uap=\"http://schemas.microsoft.com/appx/manifest/uap/windows10\">",
            "<Properties><Logo>Assets\\PackageStore.png</Logo></Properties>",
            "<Applications>",
            "<Application Id=\"First\"><uap:VisualElements ",
            "Square150x150Logo=\"Assets\\First150.png\"/></Application>",
            "<Application Id=\"Second\"><uap:VisualElements ",
            "Square44x44Logo=\"Assets\\Second44.png\" ",
            "Square150x150Logo=\"Assets\\Second150.png\">",
            "<uap:DefaultTile Wide310x150Logo=\"Assets\\SecondWide.png\"/>",
            "</uap:VisualElements></Application></Applications></Package>",
        );

        assert_eq!(
            manifest_logo_candidates(manifest, "Second"),
            vec![
                "Assets\\Second150.png",
                "Assets\\Second44.png",
                "Assets\\SecondWide.png",
                "Assets\\PackageStore.png",
            ]
        );
        assert_eq!(
            manifest_logo_candidates(manifest, "Missing"),
            vec!["Assets\\PackageStore.png"]
        );
    }

    #[test]
    fn malformed_manifest_does_not_return_partially_parsed_logos() {
        let manifest = concat!(
            "<Package xmlns:uap=\"http://schemas.microsoft.com/appx/manifest/uap/windows10\">",
            "<Applications><Application Id=\"App\"><uap:VisualElements ",
            "Square150x150Logo=\"Assets\\Partial.png\"/></Application></Applications><broken",
        );

        assert!(manifest_logo_candidates(manifest, "App").is_empty());
    }

    #[test]
    fn logo_variant_scoring_prefers_pixel_sizes() {
        assert_eq!(logo_variant_score("logo", "png", "logo.png"), Some(0));
        assert_eq!(
            logo_variant_score("logo", "png", "logo.scale-100.png"),
            Some(1_000_103)
        );
        assert_eq!(
            logo_variant_score("logo", "png", "logo.scale-400.png"),
            Some(1_000_403)
        );
        // A real pixel size at or above the target beats any scale factor.
        assert_eq!(
            logo_variant_score("logo", "png", "logo.targetsize-256.png"),
            Some(2_000_259)
        );
        assert!(
            logo_variant_score("logo", "png", "logo.targetsize-256.png").unwrap()
                > logo_variant_score("logo", "png", "logo.scale-400.png").unwrap()
        );
        // A below-target pixel size falls behind higher scale factors, which
        // can still exceed the 128px target once applied to the base logo.
        assert!(
            logo_variant_score("logo", "png", "logo.targetsize-48.png").unwrap()
                < logo_variant_score("logo", "png", "logo.scale-400.png").unwrap()
        );
        // Plating/contrast markers stay acceptable.
        assert!(
            logo_variant_score("logo", "png", "logo.targetsize-256.altform-unplated.png").is_some()
        );
        // Manifest stems and on-disk names can differ in case.
        assert!(logo_variant_score("Logo", "png", "logo.scale-200.png").is_some());
        assert_eq!(
            packaged_logo_qualifier_score("scale-200", "logo", "png"),
            logo_variant_score("logo", "png", "logo.scale-200.png")
        );
        assert_eq!(
            packaged_logo_qualifier_score("scale-200_contrast-black", "logo", "png"),
            logo_variant_score("logo", "png", "logo.scale-200_contrast-black.png")
        );
        assert!(packaged_logo_qualifier_score("scale-200_notaquali", "logo", "png").is_none());
        assert!(packaged_logo_qualifier_score("../scale-200", "logo", "png").is_none());
        let themed = logo_variant_score("Logo", "png", "Logo.Theme-Light_Scale-100.png")
            .expect("theme qualifier is still the app logo");
        let plain = logo_variant_score("Logo", "png", "Logo.scale-100.png").expect("plain scale");
        let dark = logo_variant_score("Logo", "png", "Logo.Theme-Dark_Scale-100.png")
            .expect("dark theme qualifier");
        assert!(plain > themed && themed > dark);
        for filename in [
            "other.png",
            "logo.exe",
            "logo2.png",
            "logo.random.png",
            "logo.txt.png.bak",
        ] {
            assert!(
                logo_variant_score("logo", "png", filename).is_none(),
                "expected {filename} rejected"
            );
        }
    }

    #[test]
    fn packaged_logo_references_cannot_escape_the_install_directory() {
        assert_eq!(
            normalize_packaged_logo_reference("./Assets/Square.png"),
            Some("Assets\\Square.png".to_string())
        );
        for reference in [
            r"C:\Users\Public\secret.png",
            r"\Windows\System32\secret.png",
            r"\\server\share\secret.png",
            r"Assets\..\secret.png",
            r"Assets\logo.png:stream",
        ] {
            assert_eq!(
                normalize_packaged_logo_reference(reference),
                None,
                "{reference}"
            );
        }
    }

    #[test]
    fn png_encoder_emits_a_decodable_stream() {
        // External anchors: the CRC32 check value from the spec and the RFC
        // 1950 Adler-32 example pin both checksums to the standard algorithms.
        assert_eq!(crc32(b"123456789"), 0xCBF4_3926);
        assert_eq!(adler32(b"Wikipedia"), 0x11E6_0398);

        let rgba: Vec<u8> = (0..(3 * 2 * 4)).map(|i| (i * 37) as u8).collect();
        let png = encode_png_rgba(3, 2, &rgba);

        assert_eq!(&png[..8], &PNG_SIGNATURE);
        // IHDR: length 13, type, width, height, 8-bit RGBA, no interlace.
        assert_eq!(&png[8..12], &13_u32.to_be_bytes());
        assert_eq!(&png[12..16], b"IHDR");
        assert_eq!(&png[16..20], &3_u32.to_be_bytes());
        assert_eq!(&png[20..24], &2_u32.to_be_bytes());
        assert_eq!(&png[24..29], &[8, 6, 0, 0, 0]);
        // The last four bytes are IEND's well-known CRC.
        assert_eq!(&png[png.len() - 4..], &[0xAE, 0x42, 0x60, 0x82]);

        // Locate the IDAT payload and decode the stored deflate stream back
        // into scanlines.
        let idat_at = png
            .windows(4)
            .position(|w| w == b"IDAT")
            .expect("IDAT chunk");
        let idat_len = u32::from_be_bytes(png[idat_at - 4..idat_at].try_into().unwrap()) as usize;
        let z = &png[idat_at + 4..idat_at + 4 + idat_len];
        assert_eq!(&z[..2], &[0x78, 0x01]);
        let mut pos = 2;
        let mut decoded = Vec::new();
        loop {
            let is_final = z[pos] & 1 == 1;
            let len = u16::from_le_bytes(z[pos + 1..pos + 3].try_into().unwrap());
            let nlen = u16::from_le_bytes(z[pos + 3..pos + 5].try_into().unwrap());
            assert_eq!(nlen, !len);
            pos += 5;
            decoded.extend_from_slice(&z[pos..pos + len as usize]);
            pos += len as usize;
            if is_final {
                break;
            }
        }
        assert_eq!(
            u32::from_be_bytes(z[pos..pos + 4].try_into().unwrap()),
            adler32(&decoded)
        );

        let stride = 3 * 4;
        assert_eq!(decoded.len(), 2 * (stride + 1));
        assert_eq!(decoded[0], 0, "filter byte for row 0");
        assert_eq!(&decoded[1..1 + stride], &rgba[..stride]);
        assert_eq!(decoded[stride + 1], 0, "filter byte for row 1");
        assert_eq!(&decoded[stride + 2..], &rgba[stride..]);
    }

    #[test]
    fn legacy_purge_removes_only_pre_variant_entries() {
        let cache_dir = tempfile::tempdir().expect("temp dir");
        // Current-format entries that must survive.
        fs::write(cache_dir.path().join("Code.128.data-url"), "keep").expect("write");
        fs::write(cache_dir.path().join("Code.128.png"), [1_u8, 2, 3]).expect("write");
        // Pre-variant entries that nothing reads anymore.
        fs::write(cache_dir.path().join("Code.data-url"), vec![b'x'; 1024]).expect("write");
        fs::write(
            cache_dir.path().join("Dictionary.data-url"),
            vec![b'y'; 2048],
        )
        .expect("write");

        let reclaimed = purge_legacy_entries_in(cache_dir.path()).expect("purge");

        assert_eq!(reclaimed, 1024 + 2048);
        assert!(cache_dir.path().join("Code.128.data-url").exists());
        assert!(cache_dir.path().join("Code.128.png").exists());
        assert!(!cache_dir.path().join("Code.data-url").exists());
        assert!(!cache_dir.path().join("Dictionary.data-url").exists());
    }

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

    #[test]
    fn cached_icon_paths_use_thumbnail_variant() {
        let cache_root = Path::new("/tmp/icon-cache");

        let (data_url_path, png_path) = cached_icon_paths(cache_root, "Code");

        assert_eq!(
            data_url_path,
            Path::new("/tmp/icon-cache/Code.128.data-url")
        );
        assert_eq!(png_path, Path::new("/tmp/icon-cache/Code.128.png"));
    }

    #[cfg(target_os = "macos")]
    #[test]
    fn native_app_icon_png_is_scaled_to_target_size() {
        let Some(app_path) = known_macos_app_path() else {
            return;
        };

        let Some(png_bytes) =
            resolve_native_app_icon_png(app_path).expect("native app icon lookup should not fail")
        else {
            return;
        };

        assert_eq!(
            png_dimensions(&png_bytes),
            Some((APP_ICON_TARGET_PX, APP_ICON_TARGET_PX))
        );
        assert!(
            png_bytes.len() < 200_000,
            "128px app icon PNG should stay compact, got {} bytes",
            png_bytes.len()
        );
    }

    #[cfg(target_os = "macos")]
    fn known_macos_app_path() -> Option<&'static Path> {
        [
            Path::new("/System/Applications/Calculator.app"),
            Path::new("/System/Library/CoreServices/Finder.app"),
        ]
        .into_iter()
        .find(|path| path.exists())
    }

    #[cfg(target_os = "macos")]
    fn png_dimensions(bytes: &[u8]) -> Option<(u32, u32)> {
        const PNG_SIGNATURE: &[u8; 8] = b"\x89PNG\r\n\x1a\n";

        if bytes.len() < 24 || &bytes[..8] != PNG_SIGNATURE {
            return None;
        }

        Some((
            u32::from_be_bytes(bytes[16..20].try_into().ok()?),
            u32::from_be_bytes(bytes[20..24].try_into().ok()?),
        ))
    }
}
