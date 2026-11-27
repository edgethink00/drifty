use super::*;
use zip::write::SimpleFileOptions;

#[test]
fn older_or_unknown_macos_cannot_download_an_incompatible_engine() {
    assert!(!compatible_os("13.7.1"));
    assert!(!compatible_os(""));
    assert!(!compatible_os("unknown"));
    assert!(compatible_os("14.0"));
    assert!(compatible_os("26.5\n"));
}

fn archive(entries: &[(&str, &[u8])]) -> tempfile::NamedTempFile {
    let file = tempfile::NamedTempFile::new().unwrap();
    let mut writer = zip::ZipWriter::new(file.reopen().unwrap());
    for (name, bytes) in entries {
        writer
            .start_file(*name, SimpleFileOptions::default())
            .unwrap();
        writer.write_all(bytes).unwrap();
    }
    writer.finish().unwrap();
    file
}
#[test]
fn archive_paths_cannot_escape_or_replace_other_app_data() {
    for path in [
        "../state.enc",
        "/tmp/state.enc",
        "memory-v1/state.enc",
        "Drifty Memory Engine.app/../../state.enc",
    ] {
        let zip = archive(&[(path, b"untrusted")]);
        let out = tempfile::tempdir().unwrap();
        assert!(extract(zip.path(), out.path()).is_err(), "{path}");
    }
}
#[test]
fn links_are_refused_and_clean_archives_extract() {
    let zip = archive(&[(
        "Drifty Memory Engine.app/Contents/Resources/memory-runtime/drifty-memory",
        b"owned",
    )]);
    let out = tempfile::tempdir().unwrap();
    extract(zip.path(), out.path()).unwrap();
    assert_eq!(
        fs::read(out.path().join(APP).join(PROGRAM)).unwrap(),
        b"owned"
    );
    let file = tempfile::NamedTempFile::new().unwrap();
    let mut zip = zip::ZipWriter::new(file.reopen().unwrap());
    zip.add_symlink(
        "Drifty Memory Engine.app/link",
        "/tmp",
        SimpleFileOptions::default(),
    )
    .unwrap();
    zip.finish().unwrap();
    assert!(extract(file.path(), tempfile::tempdir().unwrap().path()).is_err());
}
#[test]
fn unsigned_or_wrongly_signed_executables_are_never_accepted() {
    let folder = tempfile::tempdir().unwrap();
    if cfg!(target_os = "macos") {
        assert!(verify(folder.path(), &serde_json::from_str(SPEC).unwrap()).is_err());
    }
}

#[test]
fn only_an_earlier_installed_engine_starts_the_background_update() {
    let store = tempfile::tempdir().unwrap();
    let spec: Artifact = serde_json::from_str(SPEC).unwrap();
    let engine = |version: &str| {
        let program = store.path().join(version).join(APP).join(PROGRAM);
        fs::create_dir_all(program.parent().unwrap()).unwrap();
        fs::write(program, b"engine").unwrap();
    };
    // A Mac that never downloaded the engine is not sent one.
    assert!(!needs_update(store.path(), &spec));
    // Install stages, empty folders and stray files are not earlier engines.
    engine(".install-abc");
    fs::create_dir(store.path().join("20261101.1")).unwrap();
    fs::write(store.path().join("notes"), b"x").unwrap();
    assert!(!needs_update(store.path(), &spec));
    engine("20261115.1");
    assert!(needs_update(store.path(), &spec));
    assert_eq!(
        earlier_engines(store.path(), &spec.version),
        vec![store.path().join("20261115.1")]
    );
    // Once the pinned engine is in place there is nothing to update.
    engine(&spec.version);
    assert!(!needs_update(store.path(), &spec));
}

#[test]
#[ignore = "downloads the published, signed engine into a disposable directory"]
fn published_engine_cold_install_gatekeeper_launch_and_reuse() {
    let root = tempfile::tempdir().unwrap();
    let mut spec = artifact().unwrap();
    install_into(root.path(), &spec).unwrap();
    let bundle = root.path().join(&spec.version).join(APP);
    let worker = bundle.join(PROGRAM);
    let modified = worker.metadata().unwrap().modified().unwrap();
    let output = std::process::Command::new(&worker)
        .arg("--self-test")
        .output()
        .unwrap();
    assert!(
        output.status.success(),
        "{}",
        String::from_utf8_lossy(&output.stderr)
    );
    assert!(String::from_utf8_lossy(&output.stdout).contains("\"ready\": true"));
    install_into(root.path(), &spec).unwrap();
    assert_eq!(worker.metadata().unwrap().modified().unwrap(), modified);
    spec.team = "AAAAAAAAAA".into();
    assert!(verify(&bundle, &spec).is_err());
}
