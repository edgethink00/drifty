use std::fs::OpenOptions;
use std::io::{ErrorKind, Write};
use std::path::{Path, PathBuf};
#[cfg(target_os = "macos")]
use std::sync::mpsc;

use base64::Engine;
#[cfg(target_os = "macos")]
use objc2::rc::autoreleasepool;
#[cfg(target_os = "macos")]
use objc2::MainThreadMarker;
#[cfg(target_os = "macos")]
use objc2_app_kit::{NSModalResponseOK, NSSavePanel};
#[cfg(target_os = "macos")]
use objc2_foundation::{NSArray, NSString};
use tauri::async_runtime;
use tauri::AppHandle;

const MAX_SHARE_CARD_PNG_BYTES: usize = 20 * 1024 * 1024;
const MAX_SHARE_CARD_PNG_BASE64_CHARS: usize = (MAX_SHARE_CARD_PNG_BYTES / 3 + 1) * 4;
const PNG_SIGNATURE: &[u8; 8] = b"\x89PNG\r\n\x1a\n";
const MAX_DOWNLOAD_NAME_ATTEMPTS: u32 = 100;

/// Save the exported share-card PNG locally. macOS asks for a destination in a
/// native save panel; Windows saves into Downloads and selects the file in File
/// Explorer. The frontend renders the card (aggregates only) and sends the
/// encoded PNG; this command only decodes and writes it locally.
///
/// Returns `None` when the user cancels the native save panel.
#[tauri::command]
pub async fn share_card_save_png(
    app: tauri::AppHandle,
    file_name: String,
    png_base64: String,
) -> Result<Option<String>, String> {
    let bytes = decode_share_card_png(&png_base64)?;

    let safe_name = sanitize_file_name(&file_name);
    save_share_card(app, safe_name, bytes).await
}

#[cfg(target_os = "macos")]
async fn save_share_card(
    app: AppHandle,
    safe_name: String,
    bytes: Vec<u8>,
) -> Result<Option<String>, String> {
    // Waiting for a native panel must not occupy Tauri's async executor while
    // the user chooses a destination.
    let target = async_runtime::spawn_blocking(move || show_share_card_save_panel(app, safe_name))
        .await
        .map_err(|error| format!("Native save panel was interrupted: {error}"))??;
    let Some(target) = target else {
        return Ok(None);
    };

    async_runtime::spawn_blocking(move || {
        std::fs::write(&target, &bytes)
            .map_err(|error| format!("Could not save image: {error}"))?;
        Ok(Some(target.to_string_lossy().into_owned()))
    })
    .await
    .map_err(|error| error.to_string())?
}

#[cfg(not(target_os = "macos"))]
async fn save_share_card(
    app: AppHandle,
    safe_name: String,
    bytes: Vec<u8>,
) -> Result<Option<String>, String> {
    save_share_card_to_downloads(app, safe_name, bytes)
        .await
        .map(Some)
}

/// Windows has no native save panel wired up, so the card goes to Downloads
/// under a name that never replaces an earlier card. File Explorer then selects
/// it so the user can see where it went.
#[cfg_attr(target_os = "macos", allow(dead_code))]
async fn save_share_card_to_downloads(
    app: AppHandle,
    safe_name: String,
    bytes: Vec<u8>,
) -> Result<String, String> {
    let directory = tauri::Manager::path(&app)
        .download_dir()
        .map_err(|error| format!("Could not find the Downloads folder: {error}"))?;
    let saved = async_runtime::spawn_blocking(move || {
        write_new_share_card_file(&directory, &safe_name, &bytes)
    })
    .await
    .map_err(|error| error.to_string())??;
    let saved_path = saved.to_string_lossy().into_owned();
    // Revealing initializes COM as single-threaded on the calling thread, so it
    // runs on its own short-lived thread instead of a reused runtime worker.
    std::thread::spawn(move || {
        if let Err(error) = tauri_plugin_opener::OpenerExt::opener(&app).reveal_item_in_dir(&saved)
        {
            eprintln!("could not reveal the saved share card: {error}");
        }
    });
    Ok(saved_path)
}

#[cfg_attr(target_os = "macos", allow(dead_code))]
fn write_new_share_card_file(
    directory: &Path,
    file_name: &str,
    bytes: &[u8],
) -> Result<PathBuf, String> {
    std::fs::create_dir_all(directory).map_err(|error| format!("Could not save image: {error}"))?;
    let stem = file_name.strip_suffix(".png").unwrap_or(file_name);
    for attempt in 1..=MAX_DOWNLOAD_NAME_ATTEMPTS {
        let candidate = if attempt == 1 {
            directory.join(file_name)
        } else {
            directory.join(format!("{stem} ({attempt}).png"))
        };
        let mut file = match OpenOptions::new()
            .write(true)
            .create_new(true)
            .open(&candidate)
        {
            Ok(file) => file,
            Err(error) if error.kind() == ErrorKind::AlreadyExists => continue,
            Err(error) => return Err(format!("Could not save image: {error}")),
        };
        if let Err(error) = file.write_all(bytes) {
            drop(file);
            let _ = std::fs::remove_file(&candidate);
            return Err(format!("Could not save image: {error}"));
        }
        return Ok(candidate);
    }
    Err("Could not find an unused file name in the Downloads folder.".to_string())
}

fn decode_share_card_png(png_base64: &str) -> Result<Vec<u8>, String> {
    if png_base64.len() > MAX_SHARE_CARD_PNG_BASE64_CHARS {
        return Err("Share card image is too large to save.".to_string());
    }
    let bytes = base64::engine::general_purpose::STANDARD
        .decode(png_base64.as_bytes())
        .map_err(|error| format!("Invalid PNG payload: {error}"))?;
    if bytes.is_empty() {
        return Err("Empty PNG payload".to_string());
    }
    if bytes.len() > MAX_SHARE_CARD_PNG_BYTES {
        return Err("Share card image is too large to save.".to_string());
    }
    if !bytes.starts_with(PNG_SIGNATURE) {
        return Err("Share card image must be a PNG file.".to_string());
    }
    Ok(bytes)
}

#[cfg(target_os = "macos")]
fn show_share_card_save_panel(
    app: AppHandle,
    file_name: String,
) -> Result<Option<PathBuf>, String> {
    let (sender, receiver) = mpsc::channel();
    app.run_on_main_thread(move || {
        let _ = sender.send(show_share_card_save_panel_on_main_thread(&file_name));
    })
    .map_err(|error| error.to_string())?;

    receiver
        .recv()
        .map_err(|error| format!("Native save panel was interrupted: {error}"))?
}

#[cfg(target_os = "macos")]
fn show_share_card_save_panel_on_main_thread(file_name: &str) -> Result<Option<PathBuf>, String> {
    autoreleasepool(|_| {
        let Some(mtm) = MainThreadMarker::new() else {
            return Err("Native save panel must run on the macOS main thread.".to_string());
        };

        let panel = NSSavePanel::savePanel(mtm);
        let title = NSString::from_str("Save Drifty share card");
        let message = NSString::from_str("Choose a name and location for your PNG image.");
        let prompt = NSString::from_str("Save");
        let suggested_name = NSString::from_str(file_name);
        let png_extension = NSString::from_str("png");
        let png_types = NSArray::from_slice(&[&*png_extension]);

        panel.setTitle(Some(&title));
        panel.setMessage(Some(&message));
        panel.setPrompt(Some(&prompt));
        panel.setNameFieldStringValue(&suggested_name);
        panel.setAllowsOtherFileTypes(false);
        #[allow(deprecated)]
        panel.setAllowedFileTypes(Some(&png_types));

        if panel.runModal() != NSModalResponseOK {
            return Ok(None);
        }

        let url = panel
            .URL()
            .ok_or_else(|| "No save location was selected.".to_string())?;
        let path = url
            .path()
            .ok_or_else(|| "Selected save location is invalid.".to_string())?;
        Ok(Some(PathBuf::from(path.to_string())))
    })
}

/// Strip path separators / hidden-file prefixes and force a .png extension.
fn sanitize_file_name(raw: &str) -> String {
    let base = raw
        .trim()
        .trim_end_matches(".png")
        .chars()
        .map(|c| match c {
            '/' | '\\' | ':' | '\0' | '<' | '>' | '"' | '|' | '?' | '*' => '-',
            _ => c,
        })
        .collect::<String>();
    let trimmed = base.trim_start_matches('.').trim();
    let stem = if trimmed.is_empty() {
        "drifty-card"
    } else {
        trimmed
    };
    format!("{stem}.png")
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn sanitize_strips_separators_and_forces_png() {
        assert_eq!(
            sanitize_file_name("drifty-2026-07-18"),
            "drifty-2026-07-18.png"
        );
        // Separators become dashes; interior dots are harmless once no separators remain.
        assert_eq!(sanitize_file_name("../../etc/passwd"), "-..-etc-passwd.png");
        assert_eq!(sanitize_file_name("a/b\\c:d.png"), "a-b-c-d.png");
        assert_eq!(sanitize_file_name("a<b>c\"d|e?f*g"), "a-b-c-d-e-f-g.png");
        assert_eq!(sanitize_file_name("   "), "drifty-card.png");
        assert_eq!(sanitize_file_name(".hidden"), "hidden.png");
    }

    #[test]
    fn decode_rejects_non_png_payloads() {
        let payload = base64::engine::general_purpose::STANDARD.encode(b"not a PNG");
        assert_eq!(
            decode_share_card_png(&payload).unwrap_err(),
            "Share card image must be a PNG file."
        );
    }

    #[test]
    fn decode_accepts_png_signature() {
        let payload = base64::engine::general_purpose::STANDARD.encode(PNG_SIGNATURE);
        assert_eq!(
            decode_share_card_png(&payload).unwrap(),
            PNG_SIGNATURE.to_vec()
        );
    }

    #[test]
    fn downloads_save_never_replaces_an_earlier_card() {
        let directory = tempfile::tempdir().unwrap();

        let first =
            write_new_share_card_file(directory.path(), "drifty-card.png", b"first").unwrap();
        let second =
            write_new_share_card_file(directory.path(), "drifty-card.png", b"second").unwrap();

        assert_eq!(first, directory.path().join("drifty-card.png"));
        assert_eq!(second, directory.path().join("drifty-card (2).png"));
        assert_eq!(std::fs::read(&first).unwrap(), b"first");
        assert_eq!(std::fs::read(&second).unwrap(), b"second");
    }
}
