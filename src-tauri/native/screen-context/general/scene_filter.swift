// Included-window filter. Unknown private status follows the owner policy.
// Unlike the raw-display probe, new windows and OS overlays are not included
// by the compositor unless their exact SCWindow was in the admitted snapshot.
import AppKit
import ScreenCaptureKit
import CryptoKit

struct SceneWindowReceipt: Codable, Equatable {
    let windowId: UInt32
    let pid: Int32
    let processBirth: UInt64
    let appId: String
    let appName: String
    let siteDomain: String?
    let contentRegion: CGRect?
    let windowTitleDigest: String?
    let privacy: String
    let sitePolicyKnown: Bool
}

func sceneAttribute(_ element: AXUIElement, _ name: String) -> CFTypeRef? {
    var result: CFTypeRef?
    guard AXUIElementCopyAttributeValue(element, name as CFString, &result) == .success else { return nil }
    return result
}
func sceneString(_ element: AXUIElement, _ name: String) -> String {
    sceneAttribute(element, name) as? String ?? ""
}
func sceneRect(_ element: AXUIElement) -> CGRect? {
    guard let p = sceneAttribute(element, kAXPositionAttribute), CFGetTypeID(p) == AXValueGetTypeID(),
          let s = sceneAttribute(element, kAXSizeAttribute), CFGetTypeID(s) == AXValueGetTypeID() else { return nil }
    var point = CGPoint.zero, size = CGSize.zero
    guard AXValueGetValue(unsafeBitCast(p, to: AXValue.self), .cgPoint, &point),
          AXValueGetValue(unsafeBitCast(s, to: AXValue.self), .cgSize, &size) else { return nil }
    return CGRect(origin: point, size: size)
}
func sceneBirth(_ pid: pid_t) throws -> UInt64 {
    var info = proc_bsdinfo()
    let size = Int32(MemoryLayout<proc_bsdinfo>.stride)
    guard proc_pidinfo(pid, PROC_PIDTBSDINFO, 0, &info, size) == size, info.pbi_start_tvsec > 0 else { throw Failure.unavailable }
    return info.pbi_start_tvsec * 1_000_000 + info.pbi_start_tvusec
}

@MainActor final class SceneFilterObservation {
    let windows: [SCWindow]
    private let display: SCDisplay
    private let excluded: Set<String>
    private var elements: [UInt32: AXUIElement] = [:]
    private var observers: [AXObserver] = []
    private var tokens: [NSObjectProtocol] = []
    private var fingerprints: [UInt32: String] = [:]
    private var receipts: [SceneWindowReceipt] = []
    private var epoch: UInt64 = 1
    private let browsers: Set<String>

    init(content: SCShareableContent, display: SCDisplay, excluded: Set<String>) throws {
        guard AXIsProcessTrusted() else { throw Failure.accessibilityPermission }
        self.display = display; self.excluded = excluded
        browsers = Set(NSWorkspace.shared.urlsForApplications(toOpen: URL(string: "https://example.invalid")!).compactMap { Bundle(url: $0)?.bundleIdentifier }
            + ["com.apple.Safari", "com.google.Chrome", "com.microsoft.edgemac", "company.thebrowser.Browser", "org.mozilla.firefox", "com.brave.Browser"])
        windows = content.windows.filter { $0.windowLayer == 0 && !$0.frame.intersection(display.frame).isEmpty }
        guard !windows.isEmpty, windows.count <= 32 else { throw Failure.unavailable }
        var byPid: [pid_t: AXObserver] = [:]
        do {
            for window in windows {
                guard let app = window.owningApplication, !app.bundleIdentifier.isEmpty else { throw Failure.unavailable }
                guard !excluded.contains(app.bundleIdentifier) else { throw Failure.excluded }
                let application = AXUIElementCreateApplication(app.processID)
                AXUIElementSetMessagingTimeout(application, 0.1)
                guard let candidates = sceneAttribute(application, kAXWindowsAttribute) as? [AXUIElement] else { throw Failure.unavailable }
                let matches = candidates.filter { sceneRect($0) == window.frame }
                guard matches.count == 1 else { throw Failure.unavailable }
                let element = matches[0]
                elements[window.windowID] = element
                let observer: AXObserver
                if let existing = byPid[app.processID] { observer = existing } else {
                    var created: AXObserver?
                    guard AXObserverCreate(app.processID, { _, _, _, pointer in
                        guard let pointer else { return }
                        MainActor.assumeIsolated {
                            let owner = Unmanaged<SceneFilterObservation>.fromOpaque(pointer).takeUnretainedValue()
                            owner.epoch = owner.epoch == UInt64.max ? 0 : owner.epoch + 1
                        }
                    }, &created) == .success, let created else { throw Failure.unavailable }
                    observer = created; observers.append(created); byPid[app.processID] = created
                    CFRunLoopAddSource(CFRunLoopGetMain(), AXObserverGetRunLoopSource(created), .commonModes)
                    for name in [kAXFocusedWindowChangedNotification, kAXFocusedUIElementChangedNotification] {
                        guard AXObserverAddNotification(created, application, name as CFString, Unmanaged.passUnretained(self).toOpaque()) == .success else { throw Failure.unavailable }
                    }
                }
                for name in [kAXTitleChangedNotification, kAXMovedNotification, kAXResizedNotification, kAXUIElementDestroyedNotification] {
                    guard AXObserverAddNotification(observer, element, name as CFString, Unmanaged.passUnretained(self).toOpaque()) == .success else { throw Failure.unavailable }
                }
                let observed = try inspect(window, element)
                receipts.append(observed.0); fingerprints[window.windowID] = observed.1
            }
            for name in [NSWorkspace.didActivateApplicationNotification, NSWorkspace.sessionDidResignActiveNotification,
                         NSWorkspace.willSleepNotification, NSWorkspace.screensDidSleepNotification, NSWorkspace.activeSpaceDidChangeNotification] {
                tokens.append(NSWorkspace.shared.notificationCenter.addObserver(forName: name, object: nil, queue: .main) { [weak self] _ in
                    MainActor.assumeIsolated { self?.epoch = 0 }
                })
            }
        } catch { close(); throw error }
    }
    func close() {
        for observer in observers { CFRunLoopRemoveSource(CFRunLoopGetMain(), AXObserverGetRunLoopSource(observer), .commonModes) }
        observers.removeAll()
        for token in tokens { NSWorkspace.shared.notificationCenter.removeObserver(token) }
        tokens.removeAll()
    }
    private func inspect(_ window: SCWindow, _ element: AXUIElement) throws -> (SceneWindowReceipt, String) {
        guard let app = window.owningApplication, sceneRect(element) == window.frame else { throw Failure.changed }
        let title = sceneString(element, kAXTitleAttribute)
        var binding = title, privacy = "not_browser", siteKnown = false
        var contentRegion: CGRect? = window.frame
        var siteDomain: String? = nil
        if browsers.contains(app.bundleIdentifier) {
            var visited = 0, complete = true, normal = false, privateGroup = false, geckoPrivate = false
            var pages: [(String, String)] = []
            var pageRegions: [CGRect?] = []
            func scan(_ node: AXUIElement, _ depth: Int) {
                guard depth < 12, visited < 400 else { complete = false; return }
                visited += 1
                let id = sceneString(node, "AXIdentifier")
                if sceneString(node, "AXDOMIdentifier") == "reset-pbm-toolbar-button" { geckoPrivate = true }
                if id.hasPrefix("TabGroupPickerButton?") || id.hasPrefix("SidebarLibraryItemTabGroup?isPrivate=false") { normal = true }
                if id.hasPrefix("SidebarLibraryItemTabGroup?"), id.contains("isPrivate=true") { privateGroup = true }
                if id == "SidebarLibraryItemTab" { return }
                if sceneString(node, kAXRoleAttribute) == "AXWebArea" {
                    let url = sceneAttribute(node, "AXURL")
                    if isBrowserInterfacePage(url) { return }
                    pages.append(((url as? URL)?.absoluteString ?? url as? String ?? "", sceneString(node, "AXDescription")))
                    pageRegions.append(sceneRect(node))
                    return
                }
                if let children = sceneAttribute(node, kAXChildrenAttribute) as? [AXUIElement] {
                    for child in children { scan(child, depth + 1) }
                }
            }
            scan(element, 0)
            let mode = sceneBrowserPrivacy(appId: app.bundleIdentifier, title: title,
                windowIdentifier: sceneString(element, "AXIdentifier"), normalProof: normal,
                privateGroup: privateGroup, geckoPrivateIndicator: geckoPrivate)
            guard mode != .privateWindow else { throw Failure.privateWindow }
            // Unknown site coverage is explicit. The parent admits it only
            // when there are no site rules; a later site rule hides the record.
            privacy = mode.rawValue
            contentRegion = nil
            if complete, pages.count == 1, let url = URL(string: pages[0].0) {
                binding += "\n" + pages[0].0
                siteDomain = sceneSiteHost(url)
                siteKnown = url.isFileURL || siteDomain != nil
                contentRegion = pageRegions[0].map { $0.intersection(window.frame) }.flatMap { $0.isEmpty ? nil : $0 }
            }

        }
        guard let appName = NSRunningApplication(processIdentifier: app.processID)?.localizedName,
              !appName.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty, appName.utf8.count <= 256 else { throw Failure.unavailable }
        let titleDigest: String? = !title.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty
            && title.utf8.count <= 2048 && !title.unicodeScalars.contains(where: { $0.value < 32 || $0.value == 127 })
            ? SHA256.hash(data: Data("drifty-window-title-v1\0".utf8) + Data(title.utf8)).map { String(format: "%02x", $0) }.joined() : nil
        let receipt = SceneWindowReceipt(windowId: window.windowID, pid: app.processID,
            processBirth: try sceneBirth(app.processID), appId: app.bundleIdentifier, appName: appName,
            siteDomain: siteDomain, contentRegion: contentRegion, windowTitleDigest: titleDigest, privacy: privacy, sitePolicyKnown: siteKnown)
        return (receipt, SHA256.hash(data: Data(binding.utf8)).map { String(format: "%02x", $0) }.joined())
    }
    func snapshot() throws -> (UInt64, [SceneWindowReceipt]) {
        guard epoch > 0 else { throw Failure.changed }
        for window in windows {
            guard let element = elements[window.windowID] else { throw Failure.changed }
            let now = try inspect(window, element)
            guard receipts.contains(now.0), fingerprints[window.windowID] == now.1 else { throw Failure.changed }
        }
        return (epoch, receipts)
    }
    func validate(_ savedEpoch: UInt64) throws {
        let current = try snapshot()
        guard current.0 == savedEpoch else { throw Failure.changed }
    }
}
