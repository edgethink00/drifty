#[path = "../vendor/wry/src/webview2/data_directory.rs"]
mod data_directory;

#[test]
fn collision_is_reported_without_modifying_the_existing_file() {
    let root = tempfile::tempdir().unwrap();
    let path = root.path().join("profile");
    let original = b"existing user data must survive";
    std::fs::write(&path, original).unwrap();

    let error = data_directory::check_existing_path(&path).unwrap_err();
    assert_eq!(error.kind(), std::io::ErrorKind::AlreadyExists);
    assert!(!error
        .to_string()
        .contains(&path.to_string_lossy().to_string()));
    assert_eq!(std::fs::read(&path).unwrap(), original);
    assert_eq!(std::fs::read_dir(root.path()).unwrap().count(), 1);
}

#[test]
fn existing_and_missing_directories_are_left_for_the_runtime() {
    let root = tempfile::tempdir().unwrap();
    let existing = root.path().join("existing");
    std::fs::create_dir(&existing).unwrap();
    let sentinel = existing.join("sentinel");
    std::fs::write(&sentinel, b"preserve").unwrap();
    data_directory::check_existing_path(&existing).unwrap();
    assert_eq!(std::fs::read(sentinel).unwrap(), b"preserve");

    let missing = root.path().join("new");
    data_directory::check_existing_path(&missing).unwrap();
    assert!(!missing.exists());
}

#[cfg(unix)]
#[test]
fn symlink_target_is_checked_without_replacing_the_link() {
    let root = tempfile::tempdir().unwrap();
    let target = root.path().join("target");
    let link = root.path().join("link");
    std::fs::create_dir(&target).unwrap();
    std::os::unix::fs::symlink(&target, &link).unwrap();
    data_directory::check_existing_path(&link).unwrap();
    std::fs::remove_dir(&target).unwrap();
    std::fs::write(&target, b"preserve").unwrap();
    assert!(data_directory::check_existing_path(&link).is_err());
    assert_eq!(std::fs::read_link(&link).unwrap(), target);
    assert_eq!(std::fs::read(target).unwrap(), b"preserve");
}
