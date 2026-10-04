import ApplicationServices
import AppKit
import CoreGraphics
import Foundation

// App identity does not need Accessibility, window enumeration, or Apple
// Events. Keep this command ahead of every AX path so optional metadata cannot
// prevent app-only tracking. JSON preserves names containing line breaks.
if CommandLine.arguments.count == 2, CommandLine.arguments[1] == "--frontmost-app" {
    var identity: [String: Any] = ["version": 1, "app_name": NSNull(), "bundle_id": NSNull(), "pid": NSNull()]
    if let app = NSWorkspace.shared.frontmostApplication {
        // System Events historically identifies the application process by
        // its executable name. Avoid splitting history by localized labels;
        // Python keeps the existing bundle-based browser canonicalization.
        identity["app_name"] = app.executableURL?.lastPathComponent ?? app.localizedName
        identity["bundle_id"] = app.bundleIdentifier
        identity["pid"] = Int(app.processIdentifier)
    }
    do {
        let data = try JSONSerialization.data(withJSONObject: identity)
        print(String(decoding: data, as: UTF8.self))
        exit(0)
    } catch {
        fputs("could not serialize frontmost app\n", stderr)
        exit(1)
    }
}

// Safari's AX address field omits http://. System Events cannot coerce the
// web area's CFURL, so read only that native attribute (never page contents).
if CommandLine.arguments.count == 3, CommandLine.arguments[1] == "--safari-url" {
    func snapshot() -> [String: Any]? {
        guard let pid = Int32(CommandLine.arguments[2]), pid > 0,
              let running = NSWorkspace.shared.frontmostApplication,
              running.processIdentifier == pid,
              let bundle = running.bundleIdentifier,
              ["com.apple.Safari", "com.apple.SafariTechnologyPreview"].contains(bundle) else { return nil }
        let app = AXUIElementCreateApplication(pid)
        let deadline = ProcessInfo.processInfo.systemUptime + 0.25
        func value(_ element: AXUIElement, _ name: String) -> CFTypeRef? {
            guard ProcessInfo.processInfo.systemUptime < deadline else { return nil }
            AXUIElementSetMessagingTimeout(element, 0.05)
            var result: CFTypeRef?
            guard AXUIElementCopyAttributeValue(element, name as CFString, &result) == .success else { return nil }
            return result
        }
        guard let windowRef = value(app, kAXFocusedWindowAttribute),
              CFGetTypeID(windowRef) == AXUIElementGetTypeID() else { return nil }
        let window = windowRef as! AXUIElement
        guard let title = value(window, kAXTitleAttribute) as? String, !title.isEmpty else { return nil }
        var visited = 0
        var areas: [AXUIElement] = []
        var incomplete = false
        func walkURL(_ element: AXUIElement, _ depth: Int) {
            guard depth <= 8, visited < 64, ProcessInfo.processInfo.systemUptime < deadline else {
                incomplete = true
                return
            }
            visited += 1
            guard let role = value(element, kAXRoleAttribute) as? String else { incomplete = true; return }
            if role == "AXWebArea" { areas.append(element); return }
            guard ["AXWindow", "AXSplitGroup", "AXTabGroup", "AXGroup", "AXScrollArea"].contains(role) else { return }
            guard let kids = value(element, kAXChildrenAttribute) as? [AXUIElement] else { incomplete = true; return }
            guard kids.count <= 24 else { incomplete = true; return }
            for child in kids { walkURL(child, depth + 1) }
        }
        walkURL(window, 0)
        guard !incomplete, areas.count == 1,
              let url = value(areas[0], "AXURL") as? URL,
              ["http", "https"].contains(url.scheme ?? ""),
              NSWorkspace.shared.frontmostApplication?.processIdentifier == pid,
              let finalWindow = value(app, kAXFocusedWindowAttribute), CFEqual(window, finalWindow),
              value(window, kAXTitleAttribute) as? String == title,
              (value(areas[0], "AXURL") as? URL)?.absoluteString == url.absoluteString else { return nil }
        return ["schemaVersion": 1, "pid": pid, "bundleId": bundle, "windowTitle": title, "url": url.absoluteString]
    }
    if let result = snapshot(), let data = try? JSONSerialization.data(withJSONObject: result) {
        print(String(data: data, encoding: .utf8) ?? "null")
    } else {
        print("null")
    }
    exit(0)
}

if CommandLine.arguments.count == 2, CommandLine.arguments[1] == "--onscreen-windows" {
    let rawRows = (CGWindowListCopyWindowInfo([.optionOnScreenOnly], kCGNullWindowID) as? [[String: Any]]) ?? []
    let rows = rawRows.map { row -> [String: Any] in
        [
            "owner_name": row[kCGWindowOwnerName as String] as? String ?? NSNull(),
            "layer": row[kCGWindowLayer as String] as? Int ?? NSNull(),
            "name": row[kCGWindowName as String] as? String ?? NSNull(),
        ]
    }
    do {
        let data = try JSONSerialization.data(withJSONObject: rows)
        print(String(data: data, encoding: .utf8) ?? "[]")
        exit(0)
    } catch {
        fputs("could not serialize onscreen windows\n", stderr)
        exit(1)
    }
}

guard CommandLine.arguments.count >= 2, let pid = Int32(CommandLine.arguments[1]) else {
    fputs("usage: chatgpt_ax_helper <pid>|--onscreen-windows|--frontmost-app|--safari-url <pid>\n", stderr)
    exit(2)
}
let app = AXUIElementCreateApplication(pid)
var windowsRef: CFTypeRef?
guard AXUIElementCopyAttributeValue(app, kAXWindowsAttribute as CFString, &windowsRef) == .success,
      let windows = windowsRef as? [AXUIElement],
      let window = windows.first else {
    print("ok=0")
    exit(0)
}
func strAttr(_ el: AXUIElement, _ name: CFString) -> String {
    var value: CFTypeRef?
    guard AXUIElementCopyAttributeValue(el, name, &value) == .success, let value else { return "" }
    return (value as? String) ?? ""
}
func children(_ el: AXUIElement) -> [AXUIElement] {
    var value: CFTypeRef?
    guard AXUIElementCopyAttributeValue(el, kAXChildrenAttribute as CFString, &value) == .success else { return [] }
    return (value as? [AXUIElement]) ?? []
}
func isProjectDesc(_ desc: String) -> Bool {
    let d = desc.trimmingCharacters(in: .whitespacesAndNewlines)
    return d.hasPrefix("프로젝트:") || d.lowercased().hasPrefix("project:")
}
func projectName(_ desc: String) -> String {
    if let r = desc.range(of: ":") {
        return String(desc[r.upperBound...]).trimmingCharacters(in: .whitespacesAndNewlines)
    }
    return desc
}
let chrome = Set([
    "새 채팅", "풀 리퀘스트", "사이트", "예약", "플러그인", "고정된 스레드", "프로젝트", "최근",
    "다음으로 열기", "ChatGPT", "Codex", "뒤로", "앞으로", "더 보기", "업데이트", "사이드바 숨기기",
    "New chat", "Open with", "Pull requests", "Sites", "Scheduled", "Plugins", "Pinned",
    "Projects", "Recents",
])
var project = ""
var thread = ""
var visited = 0
func scanHeader(_ el: AXUIElement) {
    for child in children(el) {
        let role = strAttr(child, kAXRoleAttribute as CFString)
        let title = strAttr(child, kAXTitleAttribute as CFString)
        let desc = strAttr(child, kAXDescriptionAttribute as CFString)
        if isProjectDesc(desc) { project = projectName(desc) }
        if role == "AXButton", !title.isEmpty, !chrome.contains(title), !title.contains("탭 닫기"), !title.lowercased().contains("close tab"), thread.isEmpty {
            thread = title
        }
        if role == "AXGroup" { scanHeader(child) }
    }
}
func walk(_ el: AXUIElement, depth: Int) {
    if visited > 3000 || (!project.isEmpty && !thread.isEmpty) { return }
    visited += 1
    let kids = children(el)
    if kids.contains(where: { isProjectDesc(strAttr($0, kAXDescriptionAttribute as CFString)) }) {
        scanHeader(el)
        return
    }
    if depth >= 18 { return }
    for child in kids.prefix(24) { walk(child, depth: depth + 1) }
}
let t0 = Date()
walk(window, depth: 0)
let ms = Int(Date().timeIntervalSince(t0) * 1000)
if thread.isEmpty {
    print("ok=0")
} else {
    print("ok=1")
    print("project=\(project)")
    print("thread=\(thread)")
}
