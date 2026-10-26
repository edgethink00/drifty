// Native helper candidate. Not bundled or registered in the product yet.
// One foreground, fully visible TextEdit/Preview document; no display/audio.
import AppKit
import ApplicationServices
import CryptoKit
import ScreenCaptureKit
import Vision
import ImageIO
import UniformTypeIdentifiers

struct Identity: Codable, Equatable {
    let pid: UInt32, processBirth: UInt64, windowId: UInt64
    let appId: String, documentId: String
    let documentGeneration: UInt64
}
struct Facts: Codable, Equatable {
    let identity: Identity
    let permission: Bool, foreground: Bool, interactive: Bool, protected: Bool
    let visibility: String, privacy: String
    // Internal only. v1/v2 encoding and comparisons keep their original shape;
    // v3 transports this separately in a mandatory observation envelope.
    var windowTitleDigest: String? = nil
    enum CodingKeys: String, CodingKey {
        case identity, permission, foreground, interactive, protected, visibility, privacy
    }
}
struct Preflight: Codable {
    let protocolVersion: Int, requestId: UUID, facts: Facts
}
struct RefusalHeader: Codable {
    let protocolVersion: Int, requestId: UUID, refusal: String
}
struct FrameHeader: Codable {
    let pngBytes: Int, width: Int, height: Int, sha256: String
}
struct ResultHeader: Codable {
    let protocolVersion: Int, requestId: UUID
    let before: Facts, after: Facts
    let observedAtMs: Int64, text: String, ocrState: String
    let frame: FrameHeader
}
struct TextEvidenceHeader: Codable {
    let source: String, state: String, text: String
}
struct SourceResultHeader: Codable {
    let protocolVersion: Int, requestId: UUID
    let before: Facts, after: Facts
    let observedAtMs: Int64, textEvidence: TextEvidenceHeader
    let frame: FrameHeader
}
struct ActivityObservation: Encodable {
    let windowTitleDigest: String?
    enum CodingKeys: String, CodingKey { case windowTitleDigest }
    func encode(to encoder: Encoder) throws {
        var value = encoder.container(keyedBy: CodingKeys.self)
        try value.encode(windowTitleDigest, forKey: .windowTitleDigest)
    }
}
struct ActivityPreflight: Encodable {
    let protocolVersion: Int, requestId: UUID, facts: Facts
    let activityHint: ActivityObservation
}
struct ActivityResultHeader: Encodable {
    let protocolVersion: Int, requestId: UUID
    let before: Facts, after: Facts
    let activityHintBefore: ActivityObservation, activityHintAfter: ActivityObservation
    let observedAtMs: Int64, textEvidence: TextEvidenceHeader
    let frame: FrameHeader
}
@MainActor var diagnosticStage = "startup"
enum Refusal: Error { case unavailable, invalidated, permission, visibility, protected, unsupported }

func fingerprint(_ data: Data) -> String { SHA256.hash(data: data).map { String(format: "%02x", $0) }.joined() }
func activityTitleDigest(_ title: String) -> String? {
    guard !title.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty,
          title.utf8.count <= 2048,
          !title.unicodeScalars.contains(where: { $0.value < 32 || $0.value == 127 }) else { return nil }
    // Exact tracker title bytes: no trimming, case folding, suffix inference
    // or Unicode normalization. The digest is not capture/link authority.
    return fingerprint(Data("drifty-window-title-v1\0".utf8) + Data(title.utf8))
}
func packet<T: Encodable>(_ value: T) throws {
    let bytes = try JSONEncoder().encode(value)
    guard !bytes.isEmpty, bytes.count <= 16 * 1024 else { throw Refusal.unavailable }
    var size = UInt32(bytes.count).bigEndian
    FileHandle.standardOutput.write(Data(bytes: &size, count: 4))
    FileHandle.standardOutput.write(bytes)
}
func attribute(_ element: AXUIElement, _ name: String) throws -> CFTypeRef {
    var value: CFTypeRef?
    guard AXUIElementCopyAttributeValue(element, name as CFString, &value) == .success, let value else { throw Refusal.unavailable }
    return value
}
func axString(_ element: AXUIElement, _ name: String) throws -> String {
    guard let value = try attribute(element, name) as? String, !value.isEmpty, value.utf8.count <= 4096 else { throw Refusal.unavailable }
    return value
}
func rect(_ window: [String: Any]) throws -> CGRect {
    guard let bounds = window[kCGWindowBounds as String] as? [String: Any],
          let result = CGRect(dictionaryRepresentation: bounds as CFDictionary), result.width > 0, result.height > 0 else { throw Refusal.unavailable }
    return result
}

// Counts detect interaction/ABA during a job without reading key values or
// installing an input-monitoring event tap. They never become provider inputs.
func interactionEpoch() -> UInt64 {
    let events: [CGEventType] = [.keyDown, .keyUp, .flagsChanged, .mouseMoved,
        .leftMouseDown, .leftMouseUp, .rightMouseDown, .rightMouseUp,
        .otherMouseDown, .otherMouseUp, .leftMouseDragged, .rightMouseDragged,
        .otherMouseDragged, .scrollWheel]
    return events.reduce(0) { $0 + UInt64(CGEventSource.counterForEventType(.combinedSessionState, eventType: $1)) }
}
func axRect(_ element: AXUIElement) throws -> CGRect {
    var point = CGPoint.zero, size = CGSize.zero
    let position = try attribute(element, kAXPositionAttribute)
    let dimensions = try attribute(element, kAXSizeAttribute)
    guard CFGetTypeID(position) == AXValueGetTypeID(), CFGetTypeID(dimensions) == AXValueGetTypeID(),
          AXValueGetValue(unsafeBitCast(position, to: AXValue.self), .cgPoint, &point),
          AXValueGetValue(unsafeBitCast(dimensions, to: AXValue.self), .cgSize, &size),
          size.width > 0, size.height > 0 else { throw Refusal.unavailable }
    return CGRect(origin: point, size: size)
}
func focusedPID(_ name: String) throws -> pid_t {
    let element = try attribute(AXUIElementCreateSystemWide(), name)
    guard CFGetTypeID(element) == AXUIElementGetTypeID() else { throw Refusal.unavailable }
    var pid: pid_t = 0
    guard AXUIElementGetPid(unsafeBitCast(element, to: AXUIElement.self), &pid) == .success, pid > 0 else { throw Refusal.unavailable }
    return pid
}

// Dock has a full-display input-tracking window on Sonoma. Its global alpha
// is not a per-pixel opacity measurement. Admit its known normal state only
// when the signed system app is inactive, its AX tree is exactly one Dock list,
// keyboard focus belongs to the target, and the real list misses the target.
// Launchpad/Mission Control/unknown trees remain refused. No blanket layer or
// process exclusion is used for other Dock windows, popovers, or applications.
@MainActor func dockRegion(_ row: [String: Any], targetPID: pid_t) throws -> CGRect? {
    guard (row[kCGWindowLayer as String] as? Int) == 20,
          let pid = row[kCGWindowOwnerPID as String] as? Int32,
          let app = NSRunningApplication(processIdentifier: pid),
          app.bundleIdentifier == "com.apple.dock",
          app.bundleURL?.resolvingSymlinksInPath().path == "/System/Library/CoreServices/Dock.app" else { return nil }
    guard !app.isActive, try focusedPID(kAXFocusedApplicationAttribute) == targetPID,
          try focusedPID(kAXFocusedUIElementAttribute) == targetPID,
          let children = try attribute(AXUIElementCreateApplication(pid), kAXChildrenAttribute) as? [AXUIElement],
          children.count == 1, try axString(children[0], kAXRoleAttribute) == kAXListRole else { throw Refusal.unavailable }
    let region = try axRect(children[0]), full = try rect(row)
    guard region.width > 0, region.height > 0, full.contains(region),
          region.width < full.width || region.height < full.height else { throw Refusal.unavailable }
    return region
}

// Start before AppKit/AX initialization: parent death during preflight must
// not leave a helper waiting on a slow framework call. A process-local signal
// watchdog also bounds a leaked/inherited stdin writer; it affects no parent.
protocol AdmissionGate: Sendable { var admitted: Bool { get } }
func armWatchdog(_ milliseconds: Int) {
    var timer = itimerval(it_interval: timeval(tv_sec: 0, tv_usec: 0),
        it_value: timeval(tv_sec: milliseconds / 1000, tv_usec: Int32((milliseconds % 1000) * 1000)))
    guard setitimer(ITIMER_REAL, &timer, nil) == 0 else { _exit(4) }
}
final class ParentGate: AdmissionGate, @unchecked Sendable {
    private let lock = NSLock()
    private var allowed = false
    init() {
        signal(SIGALRM) { _ in _exit(4) }
        armWatchdog(1100)
        DispatchQueue.global(qos: .userInitiated).async { [self] in
            var byte: UInt8 = 0
            guard read(STDIN_FILENO, &byte, 1) == 1, byte == 1 else { _exit(3) }
            lock.lock(); allowed = true; lock.unlock()
            _ = read(STDIN_FILENO, &byte, 1)
            _exit(3)
        }
    }
    var admitted: Bool { lock.lock(); defer { lock.unlock() }; return allowed }
}

// One reader detects parent EOF even during model preparation/framework work.
// Requests carry only a fresh UUID and fixed OCR bit, never an OS target/path.
final class WorkerGate: AdmissionGate, @unchecked Sendable {
    private let lock = NSLock()
    private var request: UUID?
    private var nextWaiter: CheckedContinuation<UUID, Never>?
    private var allowed = false
    private let mode: UInt8
    init(mode: UInt8, version: Int) {
        self.mode = mode
        signal(SIGALRM) { _ in _exit(4) }
        armWatchdog(5000)
        DispatchQueue.global(qos: .userInitiated).async { [self] in
            for _ in 0..<8 {
                let bytes = exact(41)
                guard bytes.prefix(4) == Data("JOB\(version)".utf8), bytes[40] == mode,
                      let text = String(data: bytes.subdata(in: 4..<40), encoding: .ascii),
                      let id = UUID(uuidString: text) else { _exit(3) }
                lock.lock()
                guard request == nil else { _exit(3) }
                allowed = false; request = id
                let waiter = nextWaiter; nextWaiter = nil
                armWatchdog(1100)
                lock.unlock()
                waiter?.resume(returning: id)
                guard exact(1)[0] == 1 else { _exit(3) }
                lock.lock(); allowed = true; lock.unlock()
            }
            // The eighth response is still in progress. Observe EOF without
            // terminating a valid response merely because its job limit hit.
            _ = exact(1); _exit(3)
        }
    }
    private func exact(_ count: Int) -> Data {
        var bytes = Data(count: count)
        bytes.withUnsafeMutableBytes { buffer in
            var used = 0
            while used < count {
                let got = read(STDIN_FILENO, buffer.baseAddress!.advanced(by: used), count - used)
                if got < 0 && errno == EINTR { continue }
                guard got > 0 else { _exit(3) }
                used += got
            }
        }
        return bytes
    }
    func waitForNextRequest() async -> UUID {
        await withCheckedContinuation { continuation in
            lock.lock()
            if let id = request {
                lock.unlock()
                continuation.resume(returning: id)
            } else {
                guard nextWaiter == nil else { _exit(3) }
                nextWaiter = continuation
                lock.unlock()
            }
        }
    }
    var admitted: Bool { lock.lock(); defer { lock.unlock() }; return allowed }
    func ready() { armWatchdog(90_000) }
    func complete() {
        lock.lock(); defer { lock.unlock() }
        request = nil; allowed = false; armWatchdog(90_000)
    }
}

func recognizeImage(_ image: CGImage) async -> String? {
    await withCheckedContinuation { continuation in
        DispatchQueue.global(qos: .userInitiated).async {
            let result: String? = autoreleasepool {
                let request = VNRecognizeTextRequest()
                request.revision = VNRecognizeTextRequestRevision3
                request.recognitionLevel = .accurate; request.usesLanguageCorrection = false
                request.automaticallyDetectsLanguage = true; request.recognitionLanguages = ["en-US", "ko-KR"]
                do {
                    try VNImageRequestHandler(cgImage: image, options: [:]).perform([request])
                    let lines = (request.results ?? []).sorted { a, b in
                        abs(a.boundingBox.midY-b.boundingBox.midY) > 0.015 ? a.boundingBox.midY > b.boundingBox.midY : a.boundingBox.minX < b.boundingBox.minX
                    }.compactMap { $0.topCandidates(1).first?.string }
                    return String(String(lines.joined(separator: "\n").trimmingCharacters(in: .whitespacesAndNewlines)).unicodeScalars.prefix(1600))
                } catch { return nil }
            }
            continuation.resume(returning: result)
        }
    }
}

// Render only built-in synthetic text. Preparing a model never enumerates a
// window, reads accessibility, requests screen permission or captures pixels.
@MainActor func prepareOcr() async throws {
    guard let bitmap = NSBitmapImageRep(bitmapDataPlanes: nil, pixelsWide: 625, pixelsHigh: 620,
        bitsPerSample: 8, samplesPerPixel: 4, hasAlpha: true, isPlanar: false,
        colorSpaceName: .deviceRGB, bytesPerRow: 2500, bitsPerPixel: 32),
          let context = NSGraphicsContext(bitmapImageRep: bitmap) else { throw Refusal.unavailable }
    NSGraphicsContext.saveGraphicsState()
    NSGraphicsContext.current = context
    NSColor.white.setFill(); NSRect(x: 0, y: 0, width: 625, height: 620).fill()
    ("Drifty prepared OCR\nEnglish and 한국어 준비 화면" as NSString).draw(in: NSRect(x: 30, y: 50, width: 560, height: 540),
        withAttributes: [.font: NSFont.systemFont(ofSize: 20), .foregroundColor: NSColor.black])
    NSGraphicsContext.restoreGraphicsState()
    guard let image = bitmap.cgImage, let text = await recognizeImage(image), !text.isEmpty else { throw Refusal.unavailable }
}

// All observer callbacks are delivered on the main run loop. The stdin reader
// runs separately so waiting for GO never stops focus/document/session events.
@MainActor final class Observer {
    var generation: UInt64 = 1
    var ax: AXObserver?
    var tokens: [NSObjectProtocol] = []
    var timer: Timer?
    let app: AXUIElement
    let window: AXUIElement
    init(pid: pid_t, window: AXUIElement) throws {
        self.app = AXUIElementCreateApplication(pid); self.window = window
        var observer: AXObserver?
        guard AXObserverCreate(pid, { _, _, _, context in
            guard let context else { return }
            MainActor.assumeIsolated {
                Unmanaged<Observer>.fromOpaque(context).takeUnretainedValue().changed()
            }
        }, &observer) == .success, let observer else { throw Refusal.unavailable }
        ax = observer
        let context = Unmanaged.passUnretained(self).toOpaque()
        // Unsupported notifications fail closed for this candidate's restricted
        // app set. A missing observer is not treated as proof of stability.
        for (element, names) in [
            (app, [kAXFocusedWindowChangedNotification, kAXFocusedUIElementChangedNotification]),
            (window, [kAXTitleChangedNotification, kAXMovedNotification, kAXResizedNotification, kAXUIElementDestroyedNotification])
        ] {
            for name in names {
                diagnosticStage = "observer." + name
                guard AXObserverAddNotification(observer, element, name as CFString, context) == .success else { throw Refusal.unavailable }
            }
        }
        CFRunLoopAddSource(CFRunLoopGetMain(), AXObserverGetRunLoopSource(observer), .commonModes)
        for name in [NSWorkspace.didActivateApplicationNotification, NSWorkspace.sessionDidResignActiveNotification, NSWorkspace.willSleepNotification, NSWorkspace.screensDidSleepNotification, NSWorkspace.activeSpaceDidChangeNotification] {
            tokens.append(NSWorkspace.shared.notificationCenter.addObserver(forName: name, object: nil, queue: .main) { [weak self] _ in
                MainActor.assumeIsolated { self?.changed() }
            })
        }
    }
    func changed() { generation = generation == UInt64.max ? 0 : generation + 1 }
    func stop() {
        if let ax { CFRunLoopRemoveSource(CFRunLoopGetMain(), AXObserverGetRunLoopSource(ax), .commonModes) }
        for token in tokens { NSWorkspace.shared.notificationCenter.removeObserver(token) }
        tokens.removeAll(); ax = nil
    }
}

@MainActor func focusedWindow() throws -> (NSRunningApplication, AXUIElement) {
    diagnosticStage = "focus.permission"
    guard CGPreflightScreenCaptureAccess(), AXIsProcessTrusted() else { throw Refusal.permission }
    diagnosticStage = "focus.session"
    guard let session = CGSessionCopyCurrentDictionary() as? [String: Any],
          (session[kCGSessionOnConsoleKey as String] as? Bool) == true,
          (session[kCGSessionLoginDoneKey as String] as? Bool) == true else { throw Refusal.unavailable }
    guard (session["CGSSessionScreenIsLocked"] as? Bool) != true else { throw Refusal.protected }
    diagnosticStage = "focus.application"
    guard let app = NSWorkspace.shared.frontmostApplication, app.processIdentifier > 0,
          !app.isHidden, !app.isTerminated else { throw Refusal.unavailable }
    guard ["com.apple.TextEdit", "com.apple.Preview"].contains(app.bundleIdentifier ?? ""),
          let bundle = app.bundleIdentifier, let url = app.bundleURL,
          url.resolvingSymlinksInPath().path == (bundle == "com.apple.TextEdit" ? "/System/Applications/TextEdit.app" : "/System/Applications/Preview.app"),
          !app.isHidden, !app.isTerminated else { throw Refusal.unsupported }
    diagnosticStage = "focus.window"
    let element = AXUIElementCreateApplication(app.processIdentifier)
    AXUIElementSetMessagingTimeout(element, 0.1)
    let value = try attribute(element, kAXFocusedWindowAttribute)
    guard CFGetTypeID(value) == AXUIElementGetTypeID() else { throw Refusal.unavailable }
    return (app, unsafeBitCast(value, to: AXUIElement.self))
}

func hasSecureInput(_ window: AXUIElement) throws -> Bool {
    var queue = [window], count = 0
    while let element = queue.popLast() {
        count += 1
        guard count <= 512 else { throw Refusal.unavailable }
        let role = try axString(element, kAXRoleAttribute)
        if role == kAXTextFieldRole || role == kAXTextAreaRole {
            var subrole: CFTypeRef?
            let status = AXUIElementCopyAttributeValue(element, kAXSubroleAttribute as CFString, &subrole)
            guard status == .success || status == .noValue || status == .attributeUnsupported else { throw Refusal.unavailable }
            if (subrole as? String) == kAXSecureTextFieldSubrole { return true }
        }
        var children: CFTypeRef?
        let status = AXUIElementCopyAttributeValue(element, kAXChildrenAttribute as CFString, &children)
        guard status == .success || status == .noValue || status == .attributeUnsupported else { throw Refusal.unavailable }
        if let children = children as? [AXUIElement] {
            guard queue.count + children.count + count <= 512 else { throw Refusal.unavailable }
            queue.append(contentsOf: children)
        }
    }
    return false
}

@MainActor func inspect(observer: Observer, activityHint: Bool = false) throws -> Facts {
    diagnosticStage = "facts.focus"
    let (app, window) = try focusedWindow()
    guard CFEqual(window, observer.window), let bundle = app.bundleIdentifier, let birth = app.launchDate,
          observer.generation > 0 else { throw Refusal.invalidated }
    guard try focusedPID(kAXFocusedApplicationAttribute) == app.processIdentifier,
          try focusedPID(kAXFocusedUIElementAttribute) == app.processIdentifier else { throw Refusal.invalidated }
    let title = try axString(window, kAXTitleAttribute)
    // Untitled/ambiguous tabs have no verified document identity and are held.
    diagnosticStage = "facts.document"
    let document = try axString(window, kAXDocumentAttribute)
    var point = CGPoint.zero, size = CGSize.zero
    let position = try attribute(window, kAXPositionAttribute)
    let dimensions = try attribute(window, kAXSizeAttribute)
    guard CFGetTypeID(position) == AXValueGetTypeID(), CFGetTypeID(dimensions) == AXValueGetTypeID(),
          AXValueGetValue(unsafeBitCast(position, to: AXValue.self), .cgPoint, &point),
          AXValueGetValue(unsafeBitCast(dimensions, to: AXValue.self), .cgSize, &size),
          let windows = CGWindowListCopyWindowInfo([.optionOnScreenOnly, .excludeDesktopElements], kCGNullWindowID) as? [[String: Any]] else { throw Refusal.unavailable }
    let focused = CGRect(origin: point, size: size)
    diagnosticStage = "facts.window-match"
    let matches = try windows.enumerated().filter { _, value in
        guard (value[kCGWindowOwnerPID as String] as? Int32) == app.processIdentifier,
              (value[kCGWindowLayer as String] as? Int) == 0,
              (value[kCGWindowName as String] as? String) == title else { return false }
        let frame = try rect(value)
        return abs(frame.minX-focused.minX) <= 1 && abs(frame.minY-focused.minY) <= 1
            && abs(frame.width-focused.width) <= 1 && abs(frame.height-focused.height) <= 1
    }
    diagnosticStage = "facts.unique-window"
    guard matches.count == 1 else { throw Refusal.unavailable }
    let (index, target) = matches[0], bounds = try rect(target)
    guard let id = target[kCGWindowNumber as String] as? UInt32, id > 0,
          (target[kCGWindowAlpha as String] as? Double) == 1,
          let sharing = target[kCGWindowSharingState as String] as? Int, sharing != 0 else { throw Refusal.unavailable }
    // Window capture can include occluded pixels. Reject any intersecting window
    // above it instead of assuming foreground means fully visible.
    diagnosticStage = "facts.occlusion"
    for above in windows.prefix(index) {
        guard let alpha = above[kCGWindowAlpha as String] as? Double else { throw Refusal.unavailable }
        if alpha > 0 {
            let other = try dockRegion(above, targetPID: app.processIdentifier) ?? rect(above)
            if other.intersects(bounds) {
                let layer = above[kCGWindowLayer as String] as? Int ?? -1
                let sameApp = (above[kCGWindowOwnerPID as String] as? Int32) == app.processIdentifier
                fputs("screen_context_occlusion:layer=\(layer) same_app=\(sameApp) target=\(bounds) above=\(other)\n", stderr)
                throw Refusal.visibility
            }
        }
    }
    diagnosticStage = "facts.session"
    var displays = [CGDirectDisplayID](repeating: 0, count: 32), number: UInt32 = 0
    guard CGGetActiveDisplayList(32, &displays, &number) == .success,
          displays.prefix(Int(number)).contains(where: { CGDisplayBounds($0).contains(bounds) }),
          let session = CGSessionCopyCurrentDictionary() as? [String: Any],
          (session[kCGSessionOnConsoleKey as String] as? Bool) == true,
          (session[kCGSessionLoginDoneKey as String] as? Bool) == true else { throw Refusal.unavailable }
    // This internal Window Server property is a supplementary lock refusal,
    // not a public unlocked-state guarantee. Lock/revoke native QA is mandatory
    // before this candidate may be registered in the product.
    diagnosticStage = "facts.secure-input"
    guard (session["CGSSessionScreenIsLocked"] as? Bool) != true,
          try !hasSecureInput(window) else { throw Refusal.unavailable }
    return Facts(identity: Identity(pid: UInt32(app.processIdentifier), processBirth: UInt64(birth.timeIntervalSince1970 * 1_000_000), windowId: UInt64(id), appId: bundle, documentId: fingerprint(Data((bundle+"\n"+document).utf8)), documentGeneration: observer.generation &+ interactionEpoch()), permission: true, foreground: true, interactive: true, protected: false, visibility: "visible", privacy: "not_browser", windowTitleDigest: activityHint ? activityTitleDigest(title) : nil)
}

// Conservative source-aware candidate: read only a wholly visible TextArea.
// A provider-reported visible range alone can contain clipped document text.
// Unknown geometry/patterns return unavailable; they never request AXValue.
@MainActor func visibleWindowText(_ window: AXUIElement) -> String? {
    do {
        var queue = [window], count = 0, candidates = [AXUIElement]()
        while let element = queue.popLast() {
            count += 1; guard count <= 512 else { return nil }
            if try axString(element, kAXRoleAttribute) == kAXTextAreaRole { candidates.append(element) }
            var children: CFTypeRef?
            let status = AXUIElementCopyAttributeValue(element, kAXChildrenAttribute as CFString, &children)
            guard status == .success || status == .noValue || status == .attributeUnsupported else { return nil }
            if let children = children as? [AXUIElement] {
                guard count + queue.count + children.count <= 512 else { return nil }
                queue.append(contentsOf: children)
            }
        }
        guard candidates.count == 1 else { return nil }
        let area = candidates[0], areaBounds = try axRect(area)
        var ancestor = area, clip: CGRect?
        for _ in 0..<8 {
            let value = try attribute(ancestor, kAXParentAttribute)
            guard CFGetTypeID(value) == AXUIElementGetTypeID() else { return nil }
            ancestor = unsafeBitCast(value, to: AXUIElement.self)
            if try axString(ancestor, kAXRoleAttribute) == kAXScrollAreaRole {
                clip = try axRect(ancestor).intersection(axRect(window)); break
            }
        }
        guard let clip, !clip.isNull, clip.contains(areaBounds) else { return nil }
        let value = try attribute(area, kAXVisibleCharacterRangeAttribute)
        var range = CFRange(location: 0, length: 0)
        guard CFGetTypeID(value) == AXValueGetTypeID(),
              AXValueGetValue(unsafeBitCast(value, to: AXValue.self), .cfRange, &range),
              range.location >= 0, range.length >= 0, range.location <= Int.max-range.length else { return nil }
        if range.length == 0 { return "" }
        range.length = min(range.length, 1600) // AX UTF-16 units; never exceeds scalar cap.
        guard let parameter = AXValueCreate(.cfRange, &range) else { return nil }
        var boundsValue: CFTypeRef?, bounds = CGRect.zero
        guard AXUIElementCopyParameterizedAttributeValue(area, kAXBoundsForRangeParameterizedAttribute as CFString, parameter, &boundsValue) == .success,
              let boundsValue, CFGetTypeID(boundsValue) == AXValueGetTypeID(),
              AXValueGetValue(unsafeBitCast(boundsValue, to: AXValue.self), .cgRect, &bounds),
              bounds.width > 0, bounds.height > 0, clip.contains(bounds), areaBounds.contains(bounds) else { return nil }
        var raw: CFTypeRef?
        guard AXUIElementCopyParameterizedAttributeValue(area, kAXStringForRangeParameterizedAttribute as CFString, parameter, &raw) == .success,
              let raw, CFGetTypeID(raw) == CFStringGetTypeID() else { return nil }
        let string = unsafeBitCast(raw, to: CFString.self)
        // Refuse a truncated/unpaired UTF-16 surrogate instead of inventing a
        // replacement character at the collection boundary.
        let length = CFStringGetLength(string)
        var index = 0
        while index < length {
            let unit = CFStringGetCharacterAtIndex(string, index)
            if (0xD800...0xDBFF).contains(unit) {
                guard index+1 < length, (0xDC00...0xDFFF).contains(CFStringGetCharacterAtIndex(string,index+1)) else { return nil }
                index += 2
            } else {
                guard !(0xDC00...0xDFFF).contains(unit) else { return nil }
                index += 1
            }
        }
        guard let text = raw as? String else { return nil }
        if text.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty { return "" }
        return String(text.unicodeScalars.prefix(1600))
    } catch { return nil }
}

@main struct Helper {
    @MainActor static func main() {
        let args = CommandLine.arguments
        if args == [args[0], "--capabilities"] {
            print("{\"protocolVersion\":1,\"sourceProtocolVersion\":2,\"screenCaptureGranted\":\(CGPreflightScreenCaptureAccess()),\"accessibilityGranted\":\(AXIsProcessTrusted()),\"candidateOnly\":true}")
            return
        }
        if args.count == 4, args[1] == "--worker-v1", args[2] == "--ocr",
           ["on", "off"].contains(args[3]), #available(macOS 14, *) {
            worker(ocr: args[3] == "on")
            return
        }
        if args.count == 4, ["--worker-v2", "--worker-v3"].contains(args[1]), args[2] == "--text",
           let mode = ["off": UInt8(0), "ocr": 1, "accessibility": 2, "accessibility-or-ocr": 3][args[3]], #available(macOS 14, *) {
            worker(ocr: mode & 1 != 0, visible: mode & 2 != 0, version: args[1] == "--worker-v3" ? 3 : 2)
            return
        }
        guard args.count == 6, args[1] == "--protocol-v1", args[2] == "--request", let request = UUID(uuidString: args[3]), args[4] == "--ocr", ["on", "off"].contains(args[5]), #available(macOS 14, *) else { exit(2) }
        let gate = ParentGate()
        let app = NSApplication.shared
        app.setActivationPolicy(.prohibited)
        DispatchQueue.main.async {
            Task { @MainActor in
                do { try await run(request: request, ocr: args[5] == "on", gate: gate) }
                catch {
                    let code: String
                    switch error as? Refusal {
                    case .permission: code = "permission"
                    case .visibility: code = "visibility"
                    case .protected: code = "protected"
                    case .unsupported: code = "unsupported"
                    case .invalidated: code = "changed"
                    default: code = "unavailable"
                    }
                    try? packet(RefusalHeader(protocolVersion: 1, requestId: request, refusal: code))
                    fputs("screen_context_refusal:" + code + ":" + diagnosticStage + "\n", stderr)
                }
                app.terminate(nil)
            }
        }
        app.run()
    }

    @available(macOS 14, *) @MainActor static func worker(ocr: Bool, visible: Bool = false, version: Int = 1) {
        let gate = WorkerGate(mode: (ocr ? 1 : 0) | (visible ? 2 : 0), version: version)
        let app = NSApplication.shared
        app.setActivationPolicy(.prohibited)
        DispatchQueue.main.async {
            Task { @MainActor in
                do {
                    if ocr { try await prepareOcr() }
                    gate.ready()
                    FileHandle.standardOutput.write(Data("RDY\(version)".utf8))
                    for _ in 0..<8 {
                        let request = await gate.waitForNextRequest()
                        do { try await run(request: request, ocr: ocr, gate: gate, visible: visible, version: version) }
                        catch {
                            let code: String
                            switch error as? Refusal {
                            case .permission: code = "permission"
                            case .visibility: code = "visibility"
                            case .protected: code = "protected"
                            case .unsupported: code = "unsupported"
                            case .invalidated: code = "changed"
                            default: code = "unavailable"
                            }
                            try? packet(RefusalHeader(protocolVersion: version, requestId: request, refusal: code))
                            throw error
                        }
                        gate.complete()
                        FileHandle.standardOutput.write(Data(("END\(version)" + request.uuidString.lowercased()).utf8))
                    }
                } catch { /* Fixed refusal above, or no READY on preparation failure. */ }
                app.terminate(nil)
            }
        }
        app.run()
    }

    @available(macOS 14, *) @MainActor static func run(request: UUID, ocr: Bool, gate: any AdmissionGate, visible: Bool = false, version: Int = 1) async throws {
        let (app, window) = try focusedWindow()
        let observer = try Observer(pid: app.processIdentifier, window: window)
        defer { observer.stop() }
        let before = try inspect(observer: observer, activityHint: version == 3)
        if version == 3 {
            try packet(ActivityPreflight(protocolVersion: 3, requestId: request, facts: before, activityHint: ActivityObservation(windowTitleDigest: before.windowTitleDigest)))
        } else {
            try packet(Preflight(protocolVersion: version, requestId: request, facts: before))
        }
        while !gate.admitted { try await Task.sleep(nanoseconds: 2_000_000) }
        guard try inspect(observer: observer, activityHint: version == 3) == before else { throw Refusal.invalidated }
        let content = try await SCShareableContent.excludingDesktopWindows(true, onScreenWindowsOnly: true)
        guard try inspect(observer: observer, activityHint: version == 3) == before,
              let target = content.windows.first(where: { UInt64($0.windowID) == before.identity.windowId && $0.owningApplication?.processID == pid_t(before.identity.pid) }) else { throw Refusal.invalidated }
        let config = SCStreamConfiguration()
        let scale = min(1, 1920 / max(target.frame.width, target.frame.height))
        config.width = max(1, Int(target.frame.width * scale)); config.height = max(1, Int(target.frame.height * scale))
        config.showsCursor = false; config.capturesAudio = false
        // Revalidation immediately precedes the first pixel API call.
        guard try inspect(observer: observer, activityHint: version == 3) == before else { throw Refusal.invalidated }
        let image = try await SCScreenshotManager.captureImage(contentFilter: SCContentFilter(desktopIndependentWindow: target), configuration: config)
        let observed = Int64(Date().timeIntervalSince1970 * 1000)
        guard try inspect(observer: observer, activityHint: version == 3) == before else { throw Refusal.invalidated }
        var text = "", state = "not_requested", source = "none"
        if visible {
            source = "accessibility"
            if let direct = visibleWindowText(window) { text = direct; state = text.isEmpty ? "no_text" : "recognized" }
            else { state = "unavailable" }
        }
        if ocr && (!visible || state == "unavailable") {
            source = "ocr"
            // Vision runs away from the observer's main run loop. Parent's 1 s
            // deadline kills this process if Vision does not return in budget.
            let recognized = await recognizeImage(image)
            if let recognized { text = recognized; state = text.isEmpty ? "no_text" : "recognized" } else { state = "unavailable" }
        }
        let after = try inspect(observer: observer, activityHint: version == 3)
        guard after == before else { throw Refusal.invalidated }
        let encoded = NSMutableData()
        guard let output = CGImageDestinationCreateWithData(encoded, UTType.png.identifier as CFString, 1, nil) else { throw Refusal.unavailable }
        CGImageDestinationAddImage(output, image, nil)
        guard CGImageDestinationFinalize(output), encoded.length > 0, encoded.length <= 2 * 1024 * 1024,
              try inspect(observer: observer, activityHint: version == 3) == before else { throw Refusal.invalidated }
        let bytes = encoded as Data
        let frame = FrameHeader(pngBytes: bytes.count, width: image.width, height: image.height, sha256: fingerprint(bytes))
        if version == 1 {
            try packet(ResultHeader(protocolVersion: 1, requestId: request, before: before, after: after, observedAtMs: observed, text: text, ocrState: state, frame: frame))
        } else if version == 3 {
            try packet(ActivityResultHeader(protocolVersion: 3, requestId: request, before: before, after: after, activityHintBefore: ActivityObservation(windowTitleDigest: before.windowTitleDigest), activityHintAfter: ActivityObservation(windowTitleDigest: after.windowTitleDigest), observedAtMs: observed, textEvidence: TextEvidenceHeader(source: source, state: state, text: text), frame: frame))
        } else {
            try packet(SourceResultHeader(protocolVersion: 2, requestId: request, before: before, after: after, observedAtMs: observed, textEvidence: TextEvidenceHeader(source: source, state: state, text: text), frame: frame))
        }
        FileHandle.standardOutput.write(bytes)
    }
}
