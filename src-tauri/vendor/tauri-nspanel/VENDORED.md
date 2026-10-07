# tauri-nspanel 2.0.1

Source: https://github.com/ahkohd/tauri-nspanel/tree/18ffb9a201fbf6fedfaa382fd4b92315ea30ab1a

The package manifest, source files and both license notices are copied from that
pinned revision. Two source files have bounded lifetime repairs:

- `raw_nspanel.rs`: dispatch `RawNSPanel::dealloc` with its void ABI through
  `NSPanel`, instead of calling an unspecified message result as a function
  pointer and bypassing `NSPanel` teardown.
- `lib.rs`: save the actual native runtime class before panel conversion,
  including any WebKit KVO subclass. Restore it before WebView destruction,
  app exit or registry release, so WebKit can remove its existing observers.
  Remove destroyed panels from the registry and release their references
  outside the manager lock.

No dependency version, class style or active presentation behavior was upgraded.

Drifty supplies the independent native-window retain in
`commands/macos_panel.rs`; the borrowed-pointer conversion in this vendored
package remains unchanged. Do not add another retain without reconciling that
ownership bridge.

Native regression, from `src-tauri/` in a disposable macOS GUI login session:

```sh
cargo run --example native_panel_lifetime
```

It exercises this package's actual `RawNSPanel` destructor and weak-reference
cleanup, without a WebView or tracker. On macOS 26.6.2, restoring the original
destructor produced `EXC_BAD_ACCESS` / `SIGBUS` while draining the autorelease
pool; the repaired destructor passed 32 cycles with every weak reference cleared.
An additional regression exercises real Tauri/Wry WebViews and the production
ownership bridge:

```sh
cargo run --example native_webview_panel_lifetime
cargo run --example native_webview_panel_lifetime -- --registry-drop
cargo run --example native_webview_panel_lifetime -- --app-exit
cargo run --example native_webview_panel_lifetime -- --window-control
```

Without class restoration, destroying a converted WebView aborts with a WebKit
`NSRangeException` while removing its `contentLayoutRect` observer. The probe
logs the original Objective-C exception without suppressing it. It requires
normal runtime exit and survival of the native owner after panel references drop.
Destroy modes require final deallocation of all eight actual WKWebViews. The
app-exit mode leaves WebViews open and directly verifies that all original
classes are restored and the registry is empty before runtime cleanup. Tauri's
`run_return` also retains open WebViews in the unconverted control; this mode
does not assert their final deallocation. Native NSWindow weak
references are diagnostic only: they also remain live in the unconverted Tao
control, so this probe does not establish final NSWindow deallocation.

These hidden blank WebViews do not verify pet/Companion pointer interaction,
nonactivation or full-screen presentation. Whole-app panel QA remains required.
Neither regression establishes attribution to an operating Sentry event.
