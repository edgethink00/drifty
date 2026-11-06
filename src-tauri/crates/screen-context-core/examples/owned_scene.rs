//! Disposable-VM synthetic QA only. Not bundled or exposed to the renderer.
//! Image-only capture through the real worker, encrypted reopen and deletion.
use drifty_screen_context_core::{native::NativeSceneHelperBackend, store::EvidenceStore, *};
use std::{
    fs,
    io::Write,
    path::{Path, PathBuf},
    sync::Arc,
    time::{Duration, Instant},
};
use zeroize::Zeroizing;
fn private_write(path: &Path, bytes: &[u8]) -> Result<(), Box<dyn std::error::Error>> {
    let mut options = fs::OpenOptions::new();
    options.create_new(true).write(true);
    #[cfg(unix)]
    {
        use std::os::unix::fs::OpenOptionsExt;
        options.mode(0o600);
    }
    options.open(path)?.write_all(bytes)?;
    Ok(())
}
fn run() -> Result<(), Box<dyn std::error::Error>> {
    let args: Vec<_> = std::env::args_os().collect();
    if args.len() < 3 {
        return Err(
            "Usage: owned_scene VM_ONLY_HELPER NEW_ABSOLUTE_QA_DIR [--ocr] [--exclude-site HOST]"
                .into(),
        );
    }
    #[cfg(target_os = "macos")]
    {
        let mut model = [0u8; 256];
        let mut size = model.len();
        let ok = unsafe {
            libc::sysctlbyname(
                c"hw.model".as_ptr(),
                model.as_mut_ptr().cast(),
                &mut size,
                std::ptr::null_mut(),
                0,
            )
        };
        if ok != 0 || size > model.len() || !model[..size].starts_with(b"VirtualMac") {
            return Err("disposable VirtualMac required".into());
        }
    }
    let output = PathBuf::from(&args[2]);
    if !output.is_absolute() || output.exists() {
        return Err("new private QA path required".into());
    }
    let mut ocr = false;
    let mut exclusions = std::collections::BTreeSet::new();
    let mut index = 3;
    while index < args.len() {
        if args[index] == "--ocr" && !ocr {
            ocr = true;
            index += 1;
        } else if args[index] == "--exclude-site" && index + 1 < args.len() {
            let host = args[index + 1].to_str().ok_or("host UTF-8")?;
            if !valid_site_domain(host) {
                return Err("canonical host required".into());
            }
            exclusions.insert(format!("site:{host}"));
            index += 2;
        } else {
            return Err("unknown QA argument".into());
        }
    }
    let backend = NativeSceneHelperBackend::from_app_resource(Path::new(&args[1]))?;
    let backend = if ocr {
        backend.with_deferred_ocr()
    } else {
        backend
    };
    fs::create_dir(&output)?;
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        fs::set_permissions(&output, fs::Permissions::from_mode(0o700))?;
    }
    let root = output.join("synthetic-key-store");
    let open = || {
        EvidenceStore::open(
            &root,
            ScopeId::from_profile("owned-scene-qa-only")?,
            Zeroizing::new([7; 32]),
            Retention::default(),
            unix_millis()?,
        )
    };
    let mut service = ScreenContextService::new(Arc::new(backend))?;
    service.replace_store(Some(open()?))?;
    service.set_global_exclusions(Some(exclusions))?;
    service.set_policy(CapturePolicy {
        scope: CaptureScope::ActiveDisplayScene,
        enabled: true,
        replay_enabled: true,
        ocr_enabled: ocr,
        ..Default::default()
    })?;
    let started = Instant::now();
    if !service.request_sample() {
        return Err("request refused".into());
    }
    while {
        let s = service.status();
        s.pending || s.running
    } {
        if started.elapsed() > Duration::from_secs(3) {
            return Err("QA wait exceeded".into());
        }
        std::thread::sleep(Duration::from_millis(5));
    }
    let status = service.status();
    let mut receipt = serde_json::json!({"qaOnly": true,"syntheticKey": true,"protocolVersion":4,
        "elapsedMs":started.elapsed().as_millis(),"accepted":status.accepted,"dropped":status.dropped,
        "failure":status.last_failure.map(|v|format!("{v:?}")),"encryptedReopen":false,"deleted":false,
        "activityLinked":false,"productReplayUiTested":false});
    if status.accepted == 1 {
        let page = service.list_page(None, 2)?;
        if page.records.len() != 1 {
            return Err("unexpected record count".into());
        }
        let id = page.records[0].id;
        let ocr_started = Instant::now();
        if ocr {
            while service
                .read_metadata(id)?
                .ok_or("no metadata")?
                .text
                .state()
                == TextState::NotRequested
                && ocr_started.elapsed() < Duration::from_millis(1500)
            {
                std::thread::sleep(Duration::from_millis(5));
            }
        }
        let metadata = service.read_metadata(id)?.ok_or("no metadata")?;
        receipt["ocrRequested"] = ocr.into();
        receipt["ocrWaitMs"] = serde_json::json!(ocr_started.elapsed().as_millis());
        receipt["ocrRecognized"] = (metadata.text.state() == TextState::Recognized).into();
        if !metadata.surface.is_scene() {
            return Err("wrong source".into());
        }
        let frame = service.read_frame(id)?.ok_or("no pixels")?;
        receipt["metadata"] = serde_json::to_value(&metadata)?;
        service.shutdown(Duration::from_millis(1100));
        drop(service);
        let mut reopened = open()?;
        let decoded = reopened
            .read_frame(id, unix_millis()?)?
            .ok_or("reopen failed")?;
        if decoded.sha256() != frame.sha256() {
            return Err("frame mismatch".into());
        }
        private_write(&output.join("reopened-frame.png"), decoded.bytes())?;
        let restored = reopened
            .read_metadata(id, unix_millis()?)?
            .ok_or("no reopened metadata")?;
        if serde_json::to_value(&restored)? != receipt["metadata"] {
            return Err("metadata mismatch".into());
        }
        receipt["encryptedReopen"] = true.into();
        reopened.delete_record(id, unix_millis()?)?;
        receipt["deleted"] = (reopened.read_frame(id, unix_millis()?)?.is_none()
            && reopened.read_metadata(id, unix_millis()?)?.is_none())
        .into();
    } else {
        service.shutdown(Duration::from_millis(1100));
    }
    private_write(
        &output.join("result.json"),
        &serde_json::to_vec_pretty(&receipt)?,
    )?;
    if status.accepted != 1 {
        return Err("native scene was refused; fixed status in receipt".into());
    }
    println!("owned scene captured, encrypted reopen and deletion checked");
    Ok(())
}
fn main() {
    if run().is_err() {
        eprintln!("owned scene QA unavailable; inspect private fixed-status receipt");
        std::process::exit(1);
    }
}
