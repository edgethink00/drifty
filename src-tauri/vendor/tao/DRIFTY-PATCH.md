# Drifty patches to tao

Source: the published `tao 0.37.1` crate, SHA-256
`f37f381f4e048e6cdf038b5705f8cf14ad108279d46eb968140a7b291aba9400`.
The crate's license (Apache-2.0) and source are retained; Drifty's
`src-tauri/Cargo.lock` resolves it through the `[patch.crates-io]` entry in
`src-tauri/Cargo.toml`.

Changes from that crate:

- `Cargo.toml` and `Cargo.toml.orig`: enable the `exception` feature of the
  existing `objc2` dependency on Apple platforms.
- `src/platform/macos.rs`, `src/platform_impl/macos/app.rs` and
  `src/platform_impl/macos/mod.rs`: add `set_send_event_exception_hook`, which lets
  the app observe an Objective-C exception AppKit raised while dispatching an
  event before AppKit's own handler receives it.
- `src/platform/windows.rs`, `src/platform_impl/windows/mod.rs` and
  `src/platform_impl/windows/event_loop.rs`: add `end_session_requested`, set when
  Windows ends the session with `WM_ENDSESSION`, and exit immediately when that
  message arrives while the event handler is checked out; complete a redraw
  only in the paint invocation that owns the flush instead of asserting that
  paints are never re-entered.
- `src/platform_impl/windows/event_loop/paint_tests.rs`: new tests for the
  re-entrant paint case.

These files are modified; all other files are unchanged from the crate.
