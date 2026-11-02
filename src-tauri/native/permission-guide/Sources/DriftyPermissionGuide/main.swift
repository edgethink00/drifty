import AppKit
import PermissionFlow

// Shows PermissionFlow's floating panel beside System Settings so the person
// can drag Drifty into a privacy list. Drifty launches this helper, keeps its
// stdin open while the guide may stay up, and stops it once the permission is
// granted. The helper ends by itself when the panel closes, when System
// Settings quits (PermissionFlow closes the panel), when Drifty closes stdin
// or exits, or after a time limit.
//
// Usage: drifty-permission-guide --pane <pane> --app <path/to/Drifty.app> [--locale <tag>]
// Exit codes: 0 finished, 64 bad arguments, 69 unsupported macOS.

enum GuideArguments {
    static let panes: [String: PermissionFlowPane] = [
        "accessibility": .accessibility,
        "fullDiskAccess": .fullDiskAccess,
        "screenRecording": .screenRecording,
    ]

    /// The Screen Recording page has two lists, and the panel docks under the
    /// lower "System Audio Recording Only" one, so "the list above" pointed at
    /// the wrong list. Name the top list instead, in Drifty's display languages.
    static let screenRecordingTitles: [String: String] = [
        "en": "Drag **%@** to the top list to allow **%@**.",
        "ko": "**%@**을(를) 맨 위 목록으로 드래그하여 **%@** 권한을 허용하세요.",
        "ja": "**%@** を一番上のリストにドラッグして **%@** を許可してください。",
        "es": "Arrastra **%@** a la primera lista para permitir **%@**.",
        "fr": "Faites glisser **%@** dans la première liste pour autoriser **%@**.",
        "de": "Ziehe **%@** in die oberste Liste, um **%@** zu erlauben.",
        "pt-BR": "Arraste **%@** para a primeira lista para permitir **%@**.",
        "zh-Hans": "将 **%@** 拖到最上方的列表中以允许 **%@**。",
    ]

    static func screenRecordingTitle(locale: String?) -> String {
        guard let locale else { return screenRecordingTitles["en"]! }
        if let exact = screenRecordingTitles[locale] { return exact }
        let language = String(locale.split(separator: "-").first ?? "")
        return screenRecordingTitles.first { $0.key.hasPrefix(language) }?.value ?? screenRecordingTitles["en"]!
    }

    static func value(after flag: String, in arguments: [String]) -> String? {
        guard let index = arguments.firstIndex(of: flag), index + 1 < arguments.count else { return nil }
        let value = arguments[index + 1]
        return value.isEmpty || value.hasPrefix("--") ? nil : value
    }
}

/// An unattended guide must not outlive the moment it was asked for.
let maximumLifetime: TimeInterval = 15 * 60

func fail(_ message: String, code: Int32) -> Never {
    FileHandle.standardError.write(Data((message + "\n").utf8))
    exit(code)
}

let arguments = CommandLine.arguments
guard let paneName = GuideArguments.value(after: "--pane", in: arguments),
      let pane = GuideArguments.panes[paneName] else {
    fail("usage: drifty-permission-guide --pane <accessibility|fullDiskAccess|screenRecording> --app <path.app> [--locale <tag>]", code: 64)
}
guard let appPath = GuideArguments.value(after: "--app", in: arguments) else {
    fail("missing --app", code: 64)
}
let appURL = URL(fileURLWithPath: appPath).standardizedFileURL
var isDirectory: ObjCBool = false
guard appURL.pathExtension.lowercased() == "app",
      FileManager.default.fileExists(atPath: appURL.path, isDirectory: &isDirectory),
      isDirectory.boolValue else {
    fail("--app must name an existing .app bundle", code: 64)
}
let localeIdentifier = GuideArguments.value(after: "--locale", in: arguments)

guard #available(macOS 13.0, *) else {
    fail("the permission guide needs macOS 13 or later", code: 69)
}

let application = NSApplication.shared
// A guide is an accessory of Drifty: no Dock icon and no menu bar of its own.
application.setActivationPolicy(.accessory)

// Drifty keeps the write end of stdin; end-of-file means it is gone or done.
FileHandle.standardInput.readabilityHandler = { handle in
    if handle.availableData.isEmpty {
        handle.readabilityHandler = nil
        DispatchQueue.main.async { exit(0) }
    }
}

// The only windows this process opens are PermissionFlow's panel and its
// launch animation. Once no panel is left on screen the guide is over.
NotificationCenter.default.addObserver(forName: NSWindow.willCloseNotification, object: nil, queue: .main) { notification in
    guard let closing = notification.object as? NSPanel else { return }
    DispatchQueue.main.asyncAfter(deadline: .now() + 0.3) {
        let panelStillShown = NSApp.windows.contains { $0 !== closing && $0 is NSPanel && $0.isVisible }
        if !panelStillShown { exit(0) }
    }
}

DispatchQueue.main.asyncAfter(deadline: .now() + maximumLifetime) { exit(0) }

let controller = MainActor.assumeIsolated {
    PermissionFlowController(configuration: PermissionFlowConfiguration(
        requiredAppURLs: [appURL],
        promptForAccessibilityTrust: false,
        localeIdentifier: localeIdentifier,
        panelTitleTemplate: pane == .screenRecording ? GuideArguments.screenRecordingTitle(locale: localeIdentifier) : nil
    ))
}

DispatchQueue.main.async {
    MainActor.assumeIsolated {
        // The click that asked for the guide happened under the pointer a
        // moment ago, so the panel flies from there toward System Settings.
        let pointer = NSEvent.mouseLocation
        let source = CGRect(x: pointer.x - 28, y: pointer.y - 28, width: 56, height: 56)
        controller.authorize(pane: pane, suggestedAppURLs: [appURL], sourceFrameInScreen: source)
    }
}

application.run()
