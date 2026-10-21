# Windows runtime target ownership

Source: published `tauri-runtime-wry 2.12.0`, crate SHA-256
`fa829eb69860cf1fb0bedb21d2d5f1effce3527d054a68ca1cd7355c654400a3`.
Licenses and source are retained. Cargo cache metadata and the standalone lockfile
are omitted; Drifty's root Cargo lock resolves dependencies. No version upgrade.

## Reason

Tauri's Send + Sync runtime context derives Clone and owns a Tao window target.
On Windows that target contains `Rc<EventLoopRunner>`. Ordinary cross-thread
runtime-handle clone/drop therefore updates a non-atomic counter. With the pinned
Tauri 2.12.0 / Tao 0.37.1 source, eight concurrent workers using only public APIs
crashed in five of five isolated Windows processes while the runtime stayed alive.
No WebView, custom protocol, teardown race, or application data was needed.

The field WER issue NATIVE-A2 has a symbolicated Context::clone fault. Matching
uploaded PE/debug IDs place the instruction at a shared UD2 reference-count abort.
Multiple Arc guards and one Rc guard branch there: without registers or a dump,
this does not prove which guard fired or attribute every field heap crash.

## Local delta

- Windows contexts hold a weak target behind `WindowsMainThreadTarget`; its
  private upgrade refuses other threads. Only the non-Send `Wry` runtime owns
  the durable strong reference. Cloning/dropping a worker handle cannot clone
  Tao's Rc or perform final target destruction on a worker.
- The owner-thread message path upgrades only after checking the current thread;
  a gone runtime returns EventLoopClosed. Worker messages retain the event proxy.
- Windows runtime handles return the pointer-free WindowsDisplayHandle, without
  upgrading the target. No X11/Wayland borrowed connection is introduced.
- Owning-runtime monitor/cursor methods borrow the same event-loop target directly.
  Other platforms retain their original target ownership and display-handle code.
- Cargo.toml and Cargo.toml.orig register the Windows-only lifetime test executable.
  Other upstream source files are unchanged.

Inspired by [Tauri #15411](https://github.com/tauri-apps/tauri/pull/15411), but this
is a Windows-only adaptation, not that unmerged PR. In particular it does not
upgrade from worker send paths or adopt its documented display lifetime hazard.
The rejected Tao-only Rc-to-Arc change would not enforce owner-thread destruction.
[Issue #15408](https://github.com/tauri-apps/tauri/issues/15408) and the public-safe
reproducer in [#16089](https://github.com/tauri-apps/tauri/pull/16089) document the
upstream investigation. This patch does not establish that every other runtime
object is thread-safe; Drifty does not enable runtime-wry's optional tracing feature.

## Verification and removal

On Windows, using the application's patches and lock:

```sh
cargo test --manifest-path src-tauri/Cargo.toml -p tauri-runtime-wry --test windows_runtime_lifetime
```

The executable bounds fresh child processes and exercises concurrent clones,
owner teardown overlapping worker handles, post-teardown rejection and Windows
display handles, owner/worker dispatch, monitor queries, and run_return exit.
The normal app Rust suite and native WebView creation checks are separate gates.
A synthetic stress pass is not evidence of released field effectiveness.

When updating Tauri, compare ownership, final destruction, runtime exit and
platform display-handle semantics. Remove this patch only after equivalent
upstream protection is present and these native regressions pass.
