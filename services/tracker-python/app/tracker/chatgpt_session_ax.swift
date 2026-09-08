import ApplicationServices
import CoreGraphics
import Foundation

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
    fputs("usage: chatgpt_ax_helper <pid>|--onscreen-windows\n", stderr)
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
