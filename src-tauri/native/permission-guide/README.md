# Permission guide (vendored PermissionFlow)

Mac release builds bundle `permission-guide/drifty-permission-guide`, a small
AppKit helper that shows a floating panel beside the System Settings window with
Drifty's app icon, so the person can drag Drifty into a privacy list (the
Codex Computer Use pattern). `src-tauri/src/commands/permission_guide.rs` starts
it for Accessibility (macOS 27: Device Control and Data Access) and Screen
Recording while that permission is still off, and falls back to opening System
Settings when the helper or an installed app bundle is missing (development
builds, Windows, a Gatekeeper-translocated copy). Full Disk Access opens
without it until a drop is checked on that page. The helper itself accepts all
three panes.

## Contents

- `PermissionFlow/`: the `SystemSettingsKit` and `PermissionFlow` sources and
  translations of [jaywcjlove/PermissionFlow](https://github.com/jaywcjlove/PermissionFlow)
  v2.11.4 (commit `65434c9ae04dba97cf52c1dffbe3e4e62b547c82`), MIT, copied
  unchanged except two Drifty patches: `SettingsNavigator` activates System
  Settings after its asynchronous launch completes, so a cold launch does not
  leave the privacy page behind Drifty; `PermissionFlowConfiguration.panelTitleTemplate`
  lets the helper replace the panel title. The Screen Recording guide uses it to
  say the top list, because that page has a second, audio-only list right above
  the panel. Only `PermissionFlow/Package.swift` is Drifty's: it keeps those
  two modules, drops the optional status-provider products and declares Swift
  tools 5.10 so older release Xcodes build it. The app ships the notice as
  `apps/desktop/public/third-party/PermissionFlow-LICENSE.txt`.
- `Sources/DriftyPermissionGuide/main.swift`: the helper.

## Helper contract

```text
drifty-permission-guide --pane <accessibility|fullDiskAccess|screenRecording> --app <path/to/Drifty.app> [--locale <tag>]
```

- `--locale` is Drifty's display language (`en`, `ko`, `es`, `ja`, `pt-BR`,
  `zh-Hans`, `fr`, `de`); PermissionFlow ships all eight. Its strings live in
  `PermissionFlow_PermissionFlow.bundle`, bundled beside the helper; without it
  the panel falls back to English.
- The helper runs as an accessory (no Dock icon) and exits when its panel
  closes, when System Settings quits, when its stdin reaches end-of-file (Drifty
  stopped it or exited), or after 15 minutes. Exit 64 means bad arguments.
- It never prompts for a permission and reads no permission state; Drifty
  decides when the permission is granted and stops the helper.

## Build and check

`npm run build:screen-context-release` builds it with SwiftPM for the host
architecture (`xcrun swift build -c release --arch <arch>`) next to the screen
recording helpers and writes the Tauri resource config; release packaging signs
it. A local smoke without packaging:

```bash
xcrun swift build -c release --package-path src-tauri/native/permission-guide --scratch-path /tmp/permission-guide-build
```

A helper started over SSH has no window-server session; launch it from a GUI
process (Drifty itself, Terminal, or a `launchctl bootstrap gui/$UID` agent).

## Updating PermissionFlow

Copy `Sources/PermissionFlow`, `Sources/SystemSettingsKit` and `LICENSE` from
the new upstream tag over `PermissionFlow/`, keep Drifty's `Package.swift`, update
the version and commit above and in the third-party notice, rebuild, and repeat
the drag QA on the oldest supported macOS and the newest macOS. Check upstream
changes to `PermissionFlowController.authorize`, `PermissionFlowConfiguration`
and the panel's close behavior, which the helper depends on.
