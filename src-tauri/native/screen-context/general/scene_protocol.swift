// General-scene bridge into the encrypted Rust store; native parent admission required.
// Parent admission precedes pixels. Image-only so OCR cannot extend capture time.
import AppKit
import ScreenCaptureKit
import CryptoKit

func scenePacket(_ value: [String: Any]) throws {
    let body = try JSONSerialization.data(withJSONObject: value, options: [.sortedKeys])
    guard !body.isEmpty, body.count <= 16 * 1024 else { throw Failure.storage }
    var size = UInt32(body.count).bigEndian
    try FileHandle.standardOutput.write(contentsOf: Data(bytes: &size, count: 4) + body)
}
func sceneRefusal(_ request: String, _ error: Error) {
    let code: String
    switch error as? Failure {
    case .permission: code = "permission"
    case .locked, .privateWindow, .excluded: code = "protected"
    case .changed: code = "changed"
    case .physicalHost, .arguments: code = "unsupported"
    default: code = "unavailable"
    }
    try? scenePacket(["protocolVersion": 4, "requestId": request, "refusal": code])
}
@MainActor final class SceneProtocol {
    let request: String
    private var facts: [String: Any] = [:]
    private var hint: [String: Any] = ["windowTitleDigest": NSNull()]
    private let waitForAdmission: (@MainActor () async throws -> Void)?
    init(_ request: String, waitForAdmission: (@MainActor () async throws -> Void)? = nil) {
        self.request = request; self.waitForAdmission = waitForAdmission
    }
    func admit(_ focus: Focus, _ display: SCDisplay, _ window: SCWindow,
               _ admission: (UInt64, [SceneWindowReceipt]), width: Int, height: Int) async throws {
        guard let foreground = admission.1.first(where: { $0.windowId == window.windowID }) else { throw Failure.unavailable }
        var region: Any = NSNull()
        if let content = foreground.contentRegion {
            let clipped = content.intersection(display.frame)
            guard !clipped.isEmpty else { throw Failure.unavailable }
            let x = max(0, Int((clipped.minX - display.frame.minX) / display.frame.width * Double(width)))
            let y = max(0, Int((clipped.minY - display.frame.minY) / display.frame.height * Double(height)))
            let right = min(width, Int(ceil((clipped.maxX - display.frame.minX) / display.frame.width * Double(width))))
            let bottom = min(height, Int(ceil((clipped.maxY - display.frame.minY) / display.frame.height * Double(height))))
            guard right > x, bottom > y else { throw Failure.unavailable }
            region = ["x": x, "y": y, "width": right-x, "height": bottom-y]
        }
        hint = ["windowTitleDigest": foreground.windowTitleDigest as Any? ?? NSNull()]
        let windows: [[String: Any]] = admission.1.map { row in
            ["pid": row.pid, "processBirth": row.processBirth, "windowId": row.windowId,
             "appId": row.appId, "appName": row.appName, "siteDomain": row.siteDomain as Any? ?? NSNull(),
             "privacy": row.privacy, "protected": false,
             "sitePolicyKnown": row.sitePolicyKnown, "excludedSite": false]
        }
        facts = ["permission": true, "interactive": true, "inventoryComplete": true, "windows": windows,
            "identity": ["displayId": display.displayID, "observationEpoch": admission.0,
                "foreground": ["pid": focus.pid, "processBirth": focus.birth, "windowId": window.windowID, "appId": focus.bundle],
                "visibleApps": Set(admission.1.map(\.appId)).sorted(), "textScope": "none",
                "exclusionInventory": ["appNames": Set(admission.1.map { $0.appName.trimmingCharacters(in: .whitespacesAndNewlines).lowercased() }).sorted(),
                    "siteDomains": Set(admission.1.compactMap(\.siteDomain)).sorted(),
                    "sitesComplete": admission.1.allSatisfy { $0.privacy == "not_browser" || $0.sitePolicyKnown }],
                "foregroundRegion": region]]
        try scenePacket(["protocolVersion": 4, "requestId": request, "facts": facts, "activityHint": hint])
        // A closed input or any other byte is denial, never permission to sample.
        if let waitForAdmission { try await waitForAdmission() }
        else { guard try FileHandle.standardInput.read(upToCount: 1) == Data([1]) else { throw Failure.changed } }
    }
    func result(_ data: Data, width: Int, height: Int, observedAt: Int64) throws {
        guard !facts.isEmpty, data.count <= 2 * 1024 * 1024 else { throw Failure.storage }
        try scenePacket(["protocolVersion": 4, "requestId": request, "before": facts, "after": facts,
            "activityHintBefore": hint, "activityHintAfter": hint, "observedAtMs": observedAt,
            "textEvidence": ["source": "none", "state": "not_requested", "text": ""],
            "frame": ["pngBytes": data.count, "width": width, "height": height,
                "sha256": SHA256.hash(data: data).map { String(format: "%02x", $0) }.joined()]])
        try FileHandle.standardOutput.write(contentsOf: data)
    }
}
