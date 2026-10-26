//! Explicit owned-fixture native QA only; not a product command or bundled tool.
//! Requires an independently verified document fingerprint before giving GO.
//! Uses a synthetic encryption key and exports ONLY this owned fixture's result.
use drifty_screen_context_core::{
    native::{NativeHelperBackend, PreparedNativeHelperBackend},
    store::EvidenceStore,
    *,
};
use std::{
    collections::BTreeSet,
    fs::{self, OpenOptions},
    io::Write,
    path::PathBuf,
    sync::Arc,
    time::{Duration, Instant},
};
use zeroize::Zeroizing;

fn private_write(path: PathBuf, bytes: &[u8]) -> Result<(), Box<dyn std::error::Error>> {
    let mut options = OpenOptions::new();
    options.write(true).create_new(true);
    #[cfg(unix)]
    {
        use std::os::unix::fs::OpenOptionsExt;
        options.mode(0o600);
    }
    options.open(path)?.write_all(bytes)?;
    Ok(())
}
fn main() {
    if run().is_err() {
        eprintln!("owned native QA unavailable; inspect its fixed-status receipt");
        std::process::exit(1);
    }
}
fn run() -> Result<(), Box<dyn std::error::Error>> {
    let args: Vec<_> = std::env::args_os().collect();
    if args.len() != 6 && args.len() != 8 {
        return Err(
            "Usage: owned_native FIXED_HELPER APP_ID VERIFIED_DOCUMENT_SHA TEXT_MODE NEW_QA_DIRECTORY [--prepared|--sourced COUNT_1_TO_9]".into(),
        );
    }
    let prepared = args.len() == 8;
    let sourced = prepared && args[6] == "--sourced";
    let count: u8 = if prepared {
        if args[6] != "--prepared" && !sourced {
            return Err("unknown QA mode".into());
        }
        let count = args[7].to_string_lossy().parse()?;
        if !(1..=9).contains(&count) {
            return Err("one to nine owned samples required".into());
        }
        count
    } else {
        1
    };
    let helper = PathBuf::from(&args[1]);
    let document = args[3].to_string_lossy().into_owned();
    let backend: Arc<dyn CaptureBackend> = if sourced {
        Arc::new(
            PreparedNativeHelperBackend::from_source_resource(&helper)?
                .require_document(document)?,
        )
    } else if prepared {
        Arc::new(
            PreparedNativeHelperBackend::from_app_resource(&helper)?.require_document(document)?,
        )
    } else {
        Arc::new(NativeHelperBackend::from_app_resource(&helper)?.require_document(document)?)
    };
    let app = args[2].to_string_lossy().into_owned();
    let text_mode = args[4].to_string_lossy();
    let (ocr, visible) = if sourced {
        match text_mode.as_ref() {
            "off" => (false, false),
            "ocr" => (true, false),
            "accessibility" => (false, true),
            "accessibility-or-ocr" => (true, true),
            _ => return Err("unknown source-aware text mode".into()),
        }
    } else {
        (text_mode == "on", false)
    };
    if !sourced && !ocr && args[4] != "off" {
        return Err("OCR mode must be on or off".into());
    }
    let output = PathBuf::from(&args[5]);
    if !output.is_absolute() || output.exists() {
        return Err("new absolute QA directory required".into());
    }
    fs::create_dir(&output)?;
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        fs::set_permissions(&output, fs::Permissions::from_mode(0o700))?;
    }
    let mut service = ScreenContextService::new(backend)?;
    service.replace_store(Some(EvidenceStore::open(
        &output.join("synthetic-key-store"),
        ScopeId::from_profile("owned-native-qa-only")?,
        Zeroizing::new([7; 32]),
        Retention::default(),
        unix_millis()?,
    )?))?;
    service.set_policy(CapturePolicy {
        enabled: true,
        replay_enabled: true,
        ocr_enabled: ocr,
        visible_text_enabled: visible,
        allowed_apps: BTreeSet::from([app]),
        ..CapturePolicy::default()
    })?;
    for index in 1..=count {
        let before = service.status();
        let previous: BTreeSet<_> = service
            .list_page(None, 20)?
            .records
            .iter()
            .map(|row| row.id)
            .collect();
        let output = if count == 1 {
            output.clone()
        } else {
            let path = output.join(format!("sample-{index:02}"));
            fs::create_dir(&path)?;
            #[cfg(unix)]
            {
                use std::os::unix::fs::PermissionsExt;
                fs::set_permissions(&path, fs::Permissions::from_mode(0o700))?;
            }
            path
        };
        let started = Instant::now();
        if !service.request_sample() {
            return Err("owned sample not requested".into());
        }
        loop {
            let status = service.status();
            if !status.running && !status.pending {
                break;
            }
            if started.elapsed()
                > if prepared {
                    PREPARATION_DEADLINE + CAPTURE_DEADLINE + Duration::from_secs(1)
                } else {
                    Duration::from_secs(2)
                }
            {
                return Err("owned QA observation timeout".into());
            }
            std::thread::sleep(Duration::from_millis(5));
        }
        let status = service.status();
        let page = service.list_page(None, 20)?;
        let mut receipt = serde_json::json!({"qaOnly":true,"syntheticKey":true,"accepted":status.accepted-before.accepted,"dropped":status.dropped-before.dropped,"preparedProtocol":prepared,"sourceAwareProtocol":sourced,"sampleIndex":index,"failure":status.last_failure.map(|f|format!("{f:?}")),"elapsedMs":started.elapsed().as_millis()});
        if let Some(row) = page.records.iter().find(|row| !previous.contains(&row.id)) {
            let metadata = service.read_metadata(row.id)?.ok_or("missing metadata")?;
            let frame = service.read_frame(row.id)?.ok_or("missing owned frame")?;
            receipt["metadata"] = serde_json::to_value(&metadata)?;
            private_write(output.join("owned-frame.png"), frame.bytes())?;
        }
        private_write(
            output.join("result.json"),
            &serde_json::to_vec_pretty(&receipt)?,
        )?;
        if status.accepted != before.accepted + 1 {
            return Err("owned native capture refused".into());
        }
    }
    service.shutdown(Duration::from_millis(1100));
    println!("owned native capture accepted; output is private QA data");
    Ok(())
}
