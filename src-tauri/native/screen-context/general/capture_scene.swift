// Native general-screen capture. The parent alone grants pixel admission.
// Fixed process arguments only; no file output or renderer-supplied OS target.
import AppKit
import ScreenCaptureKit
import Carbon

enum Failure: String, Error { case arguments, physicalHost, permission, accessibilityPermission, locked, excluded, changed, unavailable, storage, privacyUnknown, privateWindow }

enum ScreenCaptureServiceFailure: Error { case unavailable }

@MainActor func screenCaptureCall<Value>(_ call: @MainActor () async throws -> Value) async throws -> Value {
    do { return try await call() }
    catch { throw ScreenCaptureServiceFailure.unavailable }
}

// An exit requested while this screenshot is in flight waits for it (HelperExit).
@MainActor func screenshot(_ filter: SCContentFilter, _ config: SCStreamConfiguration) async throws -> CGImage {
    HelperExit.shared.beginScreenshot()
    defer { HelperExit.shared.endScreenshot() }
    return try await screenCaptureCall {
        try await SCScreenshotManager.captureImage(contentFilter: filter, configuration: config)
    }
}

struct Focus: Equatable {
    let pid: pid_t
    let birth: UInt64
    let bundle: String
}
@MainActor private func focus() throws -> Focus {
    guard let session = CGSessionCopyCurrentDictionary() as? [String: Any],
          session[kCGSessionOnConsoleKey as String] as? Bool == true,
          session["CGSSessionScreenIsLocked"] as? Bool != true,
          !IsSecureEventInputEnabled() else { throw Failure.locked }
    guard let app = NSWorkspace.shared.frontmostApplication,
          let bundle = app.bundleIdentifier,
          !app.isTerminated, !app.isHidden else { throw Failure.unavailable }
    // Finder may have no NSRunningApplication.launchDate. Use the kernel's
    // process start time for every app instead of silently excluding such apps.
    var info = proc_bsdinfo()
    let expected = Int32(MemoryLayout<proc_bsdinfo>.stride)
    guard proc_pidinfo(app.processIdentifier, PROC_PIDTBSDINFO, 0, &info, expected) == expected,
          info.pbi_start_tvsec > 0 else { throw Failure.unavailable }
    let birth = info.pbi_start_tvsec * 1_000_000 + info.pbi_start_tvusec
    return Focus(pid: app.processIdentifier, birth: birth, bundle: bundle)
}

@MainActor private func screenCaptureFocus() throws -> Focus {
    guard CGPreflightScreenCaptureAccess() else { throw Failure.permission }
    return try focus()
}

@MainActor func captureScene(_ wire: SceneProtocol) async throws {
    let before = try screenCaptureFocus()
    guard AXIsProcessTrusted() else { throw Failure.accessibilityPermission }
    let content = try await screenCaptureCall {
        try await SCShareableContent.excludingDesktopWindows(false, onScreenWindowsOnly: true)
    }
    let app = AXUIElementCreateApplication(before.pid)
    guard let focused = sceneAttribute(app, kAXFocusedWindowAttribute),
          CFGetTypeID(focused) == AXUIElementGetTypeID(),
          let bounds = sceneRect(unsafeBitCast(focused, to: AXUIElement.self)) else { throw Failure.unavailable }
    let matches = content.windows.filter { $0.owningApplication?.processID == before.pid
        && $0.windowLayer == 0 && $0.frame == bounds }
    guard matches.count == 1 else { throw Failure.unavailable }
    let window = matches[0]
    let ranked = content.displays.map { display -> (SCDisplay, CGFloat) in
        let rect = window.frame.intersection(display.frame)
        return (display, rect.isEmpty ? 0 : rect.width * rect.height)
    }
    guard let best = ranked.max(by: { $0.1 < $1.1 }), best.1 > 0 else { throw Failure.unavailable }
    let display = best.0
    // The authorized enumeration is already complete. Check the foreground
    // identity here and recheck permission after the parent's admission.
    guard try focus() == before else { throw Failure.changed }
    let observation = try SceneFilterObservation(content: content, display: display, excluded: [])
    defer { observation.close() }
    let admission = try observation.snapshot()
    let filter = SCContentFilter(display: display, including: observation.windows)
    let config = SCStreamConfiguration()
    let scale = min(Double(filter.pointPixelScale), 1920.0 / Double(max(display.frame.width, display.frame.height)))
    config.width = max(1, Int(Double(display.frame.width) * scale))
    config.height = max(1, Int(Double(display.frame.height) * scale))
    config.showsCursor = false; config.capturesAudio = false
    try await wire.admit(before, display, window, admission, width: config.width, height: config.height)
    guard try screenCaptureFocus() == before else { throw Failure.changed }
    try observation.validate(admission.0)
    let image = try await screenshot(filter, config)
    let observedAt = Int64(Date().timeIntervalSince1970 * 1000)
    guard try screenCaptureFocus() == before else { throw Failure.changed }
    let after = try await screenCaptureCall {
        try await SCShareableContent.excludingDesktopWindows(false, onScreenWindowsOnly: true)
    }
    guard let same = after.windows.first(where: { $0.windowID == window.windowID }),
          same.frame == window.frame, same.owningApplication?.processID == before.pid,
          try screenCaptureFocus() == before else { throw Failure.changed }
    try observation.validate(admission.0)
    let bitmap = NSBitmapImageRep(cgImage: image)
    guard let data = bitmap.representation(using: .png, properties: [:]), data.count <= 2 * 1024 * 1024 else { throw Failure.storage }
    try wire.result(data, width: image.width, height: image.height, observedAt: observedAt)
}
