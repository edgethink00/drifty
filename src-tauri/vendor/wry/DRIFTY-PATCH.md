# Windows WebView2 creation-stage diagnostics

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
- `SECURITY.md`: remove one upstream trailing space.
- This note.

Drifty's existing windowing logger forwards these ERROR records as Sentry
breadcrumbs. No success logs, new events, paths, environment values, Windows
security logs, browser arguments, or machine identifiers are collected.
Options, HRESULTs, callback handling, retry behavior, and platform code outside
Windows are unchanged. Stage labels describe function boundaries: `controller`
also includes its option setup, and `webview` includes post-controller setup.
They do not identify a policy rule or the blocked binary, or prove a root cause.

On an upstream update, compare the four call sites and remove this patch if
upstream provides equivalent failure-stage evidence. Do not replay it blindly.
See [the support runbook](../../../docs/runbooks/windows-webview-diagnostics.md)
for interpretation and complementary local evidence.
