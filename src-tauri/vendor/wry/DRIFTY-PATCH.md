# Windows WebView2 creation diagnostics and data-directory validation

Source: the published `wry 0.57.0` crate, SHA-256
`a819957a01b3119af85e638a38d242af76dbc87d130dca67bfd0441072e21ff0`.
The crate's licenses and source are retained; Cargo's cache metadata and its
standalone lockfile are omitted. Drifty's `src-tauri/Cargo.lock` resolves it.

Changes from that crate:

- `Cargo.toml` and `Cargo.toml.orig`: add the existing `log 0.4` dependency on
  Windows only.
- `src/webview2/mod.rs`: inspect errors at four existing creation boundaries,
  logging a fixed stage name (`container`, `environment`, `controller`, or
  `webview`) before returning the original error unchanged.
- Before controller creation, query `ICoreWebView2Environment7::UserDataFolder`
  and use `src/webview2/data_directory.rs` to reject an existing non-directory
  at that effective root. This respects runtime environment/policy overrides.
  Keep the COM allocation owned while copying the path without UTF-16 loss.
- `SECURITY.md`: remove one upstream trailing space.
- This note.

Drifty's existing windowing logger forwards these ERROR records as Sentry
breadcrumbs. No success logs, new events, paths, environment values, Windows
security logs, browser arguments, or machine identifiers are collected.
Options, callback handling, retry behavior, and platform code outside Windows
are unchanged. The confirmed path collision now returns a path-free IO error;
other native errors/HRESULTs retain their original form. Stage labels describe
function boundaries: `controller`
also includes its option setup, and `webview` includes post-controller setup.
They do not identify a policy rule or the blocked binary, or prove a root cause.

On WebView2 155.0.4283.62, an existing file at the user-data root lets environment
creation succeed but controller creation opens a modal in the browser child
process. Drifty's Tauri window-creation function remains blocked until that
dialog is dismissed, then receives `0x8000FFFF`. The check returns before that
modal and preserves the file. It does not repair the storage collision. No
folder is created, deleted, renamed or substituted by the check. Missing paths,
metadata errors, and unavailable Environment7/getter support retain the
original runtime behavior; this is not a general permissions, disk-capacity or
startup-timeout fix. A later filesystem change can still race the check.

On an upstream update, compare the four call sites and remove this patch if
upstream provides equivalent failure-stage evidence and non-destructive path
validation. Do not replay it blindly.
See [the support runbook](../../../docs/runbooks/windows-webview-diagnostics.md)
for interpretation and complementary local evidence.
