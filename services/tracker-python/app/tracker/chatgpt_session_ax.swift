import ApplicationServices
import AppKit
import CoreGraphics
import Foundation
import Darwin
import Carbon

// The frozen tracker must spawn its own reader (the bootloader validates its
// executable parent). Keep native observers alive while it returns one small D.
func readDescriptionReply(deadline: TimeInterval, valid: () -> Bool) -> String? {
    let original = fcntl(STDIN_FILENO, F_GETFL)
    guard original >= 0, fcntl(STDIN_FILENO, F_SETFL, original | O_NONBLOCK) == 0 else { return nil }
    defer { _ = fcntl(STDIN_FILENO, F_SETFL, original) }
    var bytes = [UInt8]()
    while ProcessInfo.processInfo.systemUptime < deadline, valid() {
        var buffer = [UInt8](repeating: 0, count: 1024)
        let count = read(STDIN_FILENO, &buffer, min(buffer.count, 4096-bytes.count))
        if count == 0 { return nil }
        if count > 0 {
            bytes.append(contentsOf: buffer.prefix(count))
            if let end = bytes.firstIndex(of: 10) {
                guard bytes.count < 4096,
                      let payload = (try? JSONSerialization.jsonObject(with: Data(bytes.prefix(end)))) as? [String: Any],
                      Set(payload.keys) == Set(["description"]), let text = payload["description"] as? String,
                      !text.isEmpty, text.utf16.count <= 160 else { return nil }
                return text
            }
            if bytes.count >= 4096 { return nil }
        } else if errno != EAGAIN && errno != EINTR { return nil }
        CFRunLoopRunInMode(.defaultMode, 0.005, true)
    }
    return nil
}

// Browser-owned scripting metadata admits a normal window before any page text
// is read. This command never executes browser JavaScript, requests permission,
// captures pixels or consumes an extension/socket. With an explicit product
// stdio handshake, an anonymous public description may be added within the same
// observation/deadline. Native identity remains authoritative for H/B admission.
if [7, 8].contains(CommandLine.arguments.count), CommandLine.arguments[1] == "--browser-content" {
    final class Changes { var invalidated = false }
    func sample() -> [String: Any]? {
        let allowed = ["com.google.Chrome", "com.google.Chrome.canary", "com.google.Chrome.forTesting", "com.google.chrome.for.testing", "org.chromium.Chromium", "com.microsoft.edgemac", "com.brave.Browser"]
        guard let pid = Int32(CommandLine.arguments[2]), pid > 0,
              let milliseconds = Double(CommandLine.arguments[6]), milliseconds > 0,
              AXIsProcessTrusted(),
              let running = NSWorkspace.shared.frontmostApplication,
              running.processIdentifier == pid, !running.isTerminated,
              running.bundleIdentifier == CommandLine.arguments[3],
              allowed.contains(CommandLine.arguments[3]),
              let url = URL(string: CommandLine.arguments[4]), ["http", "https"].contains(url.scheme ?? ""),
              let host = url.host, url.absoluteString.utf16.count <= 4096,
              !CommandLine.arguments[5].isEmpty, CommandLine.arguments[5].count <= 500 else { return nil }
        // Retain the earlier message/editor and authentication/payment exclusions.
        // These are conservative exclusions, not a comprehensive sensitivity detector.
        let excluded = ["slack.com", "discord.com", "whatsapp.com", "telegram.org", "messenger.com", "mail.google.com", "outlook.live.com", "outlook.office.com", "teams.microsoft.com", "chatgpt.com", "claude.ai", "notion.so", "docs.google.com"]
        guard !excluded.contains(where: { host.lowercased() == $0 || host.lowercased().hasSuffix("." + $0) }),
              url.path.range(of: #"(?:^|/)(?:login|signin|sign-in|auth|oauth|checkout|billing|payment|account|profile|messages|inbox|chat)(?:/|$)"#, options: .regularExpression.union(.caseInsensitive)) == nil else { return nil }
        let deadline = ProcessInfo.processInfo.systemUptime + min(milliseconds / 1000, 0.62)
        func code(_ text: String) -> UInt32 { text.utf8.reduce(0) { ($0 << 8) | UInt32($1) } }
        let target = NSAppleEventDescriptor(processIdentifier: pid)
        guard AEDeterminePermissionToAutomateTarget(target.aeDesc, code("core"), code("getd"), false) == noErr else { return nil }
        func specifier(_ desired: String, _ form: String, _ key: NSAppleEventDescriptor, _ container: NSAppleEventDescriptor) -> NSAppleEventDescriptor? {
            let record = NSAppleEventDescriptor.record()
            record.setDescriptor(NSAppleEventDescriptor(typeCode: code(desired)), forKeyword: code("want"))
            record.setDescriptor(NSAppleEventDescriptor(enumCode: code(form)), forKeyword: code("form"))
            record.setDescriptor(key, forKeyword: code("seld"))
            record.setDescriptor(container, forKeyword: code("from"))
            return record.coerce(toDescriptorType: code("obj "))
        }
        guard let scriptWindow = specifier("cwin", "indx", NSAppleEventDescriptor(int32: 1), NSAppleEventDescriptor.null()) else { return nil }
        func property(_ name: String, _ container: NSAppleEventDescriptor) -> NSAppleEventDescriptor? {
            specifier("prop", "prop", NSAppleEventDescriptor(typeCode: code(name)), container)
        }
        guard let tab = property("acTa", scriptWindow) else { return nil }
        struct Identity: Equatable { let mode: String; let windowID: String; let title: String; let tabID: String; let url: String; let tabTitle: String; let bounds: CGRect }
        func scriptingIdentity() -> Identity? {
            // Chromium rejects a list of property specifiers as core/getd's
            // direct object (-1700). Read each property within the same total
            // deadline; both complete snapshots must still agree afterward.
            func read(_ name: String, _ container: NSAppleEventDescriptor) -> NSAppleEventDescriptor? {
                let remaining = deadline - ProcessInfo.processInfo.systemUptime
                guard remaining > 0, let object = property(name, container) else { return nil }
                let event = NSAppleEventDescriptor(eventClass: code("core"), eventID: code("getd"), targetDescriptor: target,
                    returnID: AEReturnID(kAutoGenerateReturnID), transactionID: AETransactionID(kAnyTransactionID))
                event.setParam(object, forKeyword: code("----"))
                guard let reply = try? event.sendEvent(options: [.waitForReply, .neverInteract, .dontRecord], timeout: min(0.15, remaining)),
                      (reply.paramDescriptor(forKeyword: code("errn"))?.int32Value ?? 0) == 0 else { return nil }
                return reply.paramDescriptor(forKeyword: code("----"))
            }
            guard let mode = read("mode", scriptWindow)?.stringValue, mode == "normal",
                  let windowID = read("ID  ", scriptWindow)?.stringValue, !windowID.isEmpty,
                  let title = read("pnam", scriptWindow)?.stringValue, !title.isEmpty,
                  let tabID = read("ID  ", tab)?.stringValue, !tabID.isEmpty,
                  let currentURL = read("URL ", tab)?.stringValue, currentURL == url.absoluteString,
                  let tabTitle = read("pnam", tab)?.stringValue, tabTitle == CommandLine.arguments[5],
                  let bounds = read("pbnd", scriptWindow), bounds.descriptorType == typeQDRectangle,
                  bounds.data.count == 4 * MemoryLayout<Int16>.size else { return nil }
            // Native core/getd returns a QuickDraw rectangle, not the list
            // produced by AppleScript's language-level bounds coercion.
            // Four native signed shorts: top, left, bottom, right.
            var qd = [Int16](repeating: 0, count: 4)
            _ = qd.withUnsafeMutableBytes { bounds.data.copyBytes(to: $0) }
            let b = qd.map { CGFloat($0) }
            let rect = CGRect(x: b[1], y: b[0], width: b[3] - b[1], height: b[2] - b[0])
            guard rect.width > 0, rect.height > 0 else { return nil }
            return Identity(mode: mode, windowID: windowID, title: title, tabID: tabID, url: currentURL, tabTitle: tabTitle, bounds: rect)
        }
        guard let before = scriptingIdentity() else { return nil }
        func birth() -> String? {
            var info = proc_bsdinfo()
            let size = Int32(MemoryLayout<proc_bsdinfo>.size)
            guard proc_pidinfo(pid, PROC_PIDTBSDINFO, 0, &info, size) == size, info.pbi_start_tvsec > 0 else { return nil }
            return "\(info.pbi_start_tvsec):\(info.pbi_start_tvusec)"
        }
        guard let processBirth = birth() else { return nil }
        let application = AXUIElementCreateApplication(pid)
        let changes = Changes()
        let workspaceObserver = NSWorkspace.shared.notificationCenter.addObserver(forName: NSWorkspace.didActivateApplicationNotification, object: nil, queue: .main) { _ in changes.invalidated = true }
        defer { NSWorkspace.shared.notificationCenter.removeObserver(workspaceObserver) }
        var observer: AXObserver?
        guard AXObserverCreate(pid, { _, _, _, ref in
            if let ref = ref { Unmanaged<Changes>.fromOpaque(ref).takeUnretainedValue().invalidated = true }
        }, &observer) == .success, let observer = observer else { return nil }
        let source = AXObserverGetRunLoopSource(observer)
        CFRunLoopAddSource(CFRunLoopGetCurrent(), source, .defaultMode)
        defer { CFRunLoopRemoveSource(CFRunLoopGetCurrent(), source, .defaultMode) }
        func watch(_ element: AXUIElement, _ notifications: [String]) {
            for name in notifications { _ = AXObserverAddNotification(observer, element, name as CFString, Unmanaged.passUnretained(changes).toOpaque()) }
        }
        watch(application, ["AXFocusedWindowChanged", "AXFocusedUIElementChanged"])
        func pump() { CFRunLoopRunInMode(.defaultMode, 0, true) }
        func attribute(_ element: AXUIElement, _ name: String) -> CFTypeRef? {
            pump()
            guard !changes.invalidated, ProcessInfo.processInfo.systemUptime < deadline else { return nil }
            AXUIElementSetMessagingTimeout(element, 0.025)
            var result: CFTypeRef?
            return AXUIElementCopyAttributeValue(element, name as CFString, &result) == .success ? result : nil
        }
        func shape(_ element: AXUIElement) -> (String, String, [AXUIElement]?, CGRect?) {
            pump()
            guard !changes.invalidated, ProcessInfo.processInfo.systemUptime < deadline else { return ("", "", nil, nil) }
            AXUIElementSetMessagingTimeout(element, 0.025)
            var values: CFArray?
            let names = ["AXRole", "AXSubrole", "AXChildren", "AXPosition", "AXSize"] as CFArray
            guard AXUIElementCopyMultipleAttributeValues(element, names, AXCopyMultipleAttributeOptions(rawValue: 0), &values) == .success,
                  let items = values as? [Any], items.count == 5 else { return ("", "", nil, nil) }
            var bounds: CGRect?
            if CFGetTypeID(items[3] as CFTypeRef) == AXValueGetTypeID(), CFGetTypeID(items[4] as CFTypeRef) == AXValueGetTypeID() {
                var p = CGPoint.zero; var size = CGSize.zero
                if AXValueGetValue(items[3] as! AXValue, .cgPoint, &p), AXValueGetValue(items[4] as! AXValue, .cgSize, &size), size.width >= 0, size.height >= 0, p.x.isFinite, p.y.isFinite, size.width.isFinite, size.height.isFinite { bounds = CGRect(origin: p, size: size) }
            }
            return (items[0] as? String ?? "", items[1] as? String ?? "", items[2] as? [AXUIElement], bounds)
        }
        func string(_ element: AXUIElement, _ name: String) -> String { attribute(element, name) as? String ?? "" }
        func rectangle(_ element: AXUIElement) -> CGRect? {
            guard let p = attribute(element, "AXPosition"), CFGetTypeID(p) == AXValueGetTypeID(),
                  let s = attribute(element, "AXSize"), CFGetTypeID(s) == AXValueGetTypeID() else { return nil }
            var point = CGPoint.zero; var size = CGSize.zero
            guard AXValueGetValue(p as! AXValue, .cgPoint, &point), AXValueGetValue(s as! AXValue, .cgSize, &size), size.width > 0, size.height > 0 else { return nil }
            return CGRect(origin: point, size: size)
        }
        func sameBounds(_ a: CGRect, _ b: CGRect) -> Bool { abs(a.minX-b.minX) <= 2 && abs(a.minY-b.minY) <= 2 && abs(a.width-b.width) <= 2 && abs(a.height-b.height) <= 2 }
        func nativeWindowID(_ bounds: CGRect) -> Int? {
            let rows = (CGWindowListCopyWindowInfo([.optionOnScreenOnly, .excludeDesktopElements], kCGNullWindowID) as? [[String: Any]] ?? []).filter {
                ($0[kCGWindowOwnerPID as String] as? NSNumber)?.int32Value == pid && ($0[kCGWindowLayer as String] as? NSNumber)?.intValue == 0
            }
            let matches = rows.filter { row in
                guard let b = row[kCGWindowBounds as String] as? [String: Any], let rect = CGRect(dictionaryRepresentation: b as CFDictionary) else { return false }
                return sameBounds(rect, bounds)
            }
            guard matches.count == 1, let id = matches[0][kCGWindowNumber as String] as? NSNumber,
                  (rows.first?[kCGWindowNumber as String] as? NSNumber) == id else { return nil }
            return id.intValue
        }
        // Reading the application role opens Chromium's native accessibility
        // tree. No AXEnhancedUserInterface preference/permission setter.
        _ = attribute(application, "AXRole")
        guard let reference = attribute(application, "AXFocusedWindow"), CFGetTypeID(reference) == AXUIElementGetTypeID() else { return nil }
        let window = reference as! AXUIElement
        // Chromium can middle-elide the scripting window name even though its
        // tab name and AX window title are complete. Compare against the exact
        // tab title already matched to the caller, with the native app brand.
        // Keep the scripting window name in the before/after identity proof.
        let nativeTitle = string(window, "AXTitle")
        let titleMatches = nativeTitle == before.tabTitle || running.localizedName.map { nativeTitle == before.tabTitle + " - " + $0 } == true
        guard titleMatches, let windowBounds = rectangle(window),
              sameBounds(windowBounds, before.bounds), let windowID = nativeWindowID(windowBounds) else { return nil }
        watch(window, ["AXUIElementDestroyed", "AXMoved", "AXResized"])
        var areas: [AXUIElement] = []; var locateCount = 0; var incomplete = false
        func locate(_ element: AXUIElement, _ depth: Int) {
            guard depth < 14, locateCount < 120 else { incomplete = true; return }
            locateCount += 1
            let role = string(element, "AXRole")
            if role == "AXWebArea" { areas.append(element); return }
            guard let children = attribute(element, "AXChildren") as? [AXUIElement] else { return }
            for child in children { locate(child, depth + 1) }
        }
        locate(window, 0)
        guard !incomplete, areas.count == 1 else { return nil }
        let area = areas[0]
        func areaURL() -> String? { let v = attribute(area, "AXURL"); return (v as? URL)?.absoluteString ?? v as? String }
        guard areaURL() == before.url, let areaBounds = rectangle(area) else { return nil }
        watch(area, ["AXUIElementDestroyed", "AXLoadComplete", "AXLayoutComplete", "AXSelectedChildrenChanged", "AXValueChanged"])
        let viewport = areaBounds.intersection(windowBounds)
        guard !viewport.isNull, !viewport.isEmpty else { return nil }
        let inputRoles: Set<String> = ["AXTextField", "AXTextArea", "AXSearchField", "AXComboBox", "AXSecureTextField"]
        let excludedLandmarks: Set<String> = ["AXLandmarkNavigation", "AXLandmarkSearch", "AXLandmarkBanner", "AXLandmarkContentInfo", "AXLandmarkComplementary", "AXApplicationDialog", "AXApplicationAlertDialog"]
        struct PlanNode {
            let element: AXUIElement; let role: String; let subrole: String
            var children: [Int]; var possibleText: Bool
        }
        var plan: [PlanNode] = []; var mains: [Int] = []; var inspected = 0; var sensitive = false
        // Complete role/structure inspection precedes text. Geometry is only a
        // per-sample selection prefilter, never a reason to skip this inspection.
        // Chromium can expose offscreen text as a zero-height rectangle. Keep
        // that known empty geometry distinct from unavailable geometry; either
        // way, fresh whole-viewport bounds and exact hit admission still follow.
        // The 8192-node cap bounds memory; the existing 620ms deadline remains.
        func inspect(_ element: AXUIElement, _ depth: Int) -> Int? {
            guard depth < 24, inspected < 8192 else { incomplete = true; return nil }
            inspected += 1
            let (role, subrole, children, bounds) = shape(element)
            if role.isEmpty { incomplete = true; return nil }
            let index = plan.count
            plan.append(PlanNode(element: element, role: role, subrole: subrole, children: [], possibleText: role == "AXStaticText" && (bounds.map { !$0.isEmpty && viewport.intersects($0) } ?? true)))
            if role == "AXSecureTextField" || subrole == "AXSecureTextField" || role == "AXTextArea" { sensitive = true; return index }
            if inputRoles.contains(role) { return index }
            if subrole == "AXLandmarkMain" { mains.append(index) }
            if role == "AXWebArea", !CFEqual(element, area) { return index }
            if children == nil && ["AXWebArea", "AXGroup", "AXScrollArea", "AXHeading"].contains(role) { incomplete = true; return index }
            for child in children ?? [] {
                if let childIndex = inspect(child, depth + 1) {
                    plan[index].children.append(childIndex)
                    plan[index].possibleText = plan[index].possibleText || plan[childIndex].possibleText
                }
            }
            return index
        }
        let areaIndex = inspect(area, 0)
        guard !sensitive, !incomplete, !changes.invalidated, let areaIndex = areaIndex else { return nil }
        func clean(_ value: String, _ cap: Int) -> String {
            let text = value.split(whereSeparator: { $0.isWhitespace }).joined(separator: " ")
            var result = ""
            for character in text { if result.utf16.count + String(character).utf16.count > cap { break }; result.append(character) }
            return result.trimmingCharacters(in: .whitespacesAndNewlines)
        }
        var headings: [String] = []; var topic: [String] = []; var visited = 0
        let title = clean(before.tabTitle, 500).lowercased()
        struct Chunk { let raw: String; let bounds: CGRect; let heading: Bool; let ordinal: Int }
        var chunks: [Chunk] = []; var assemblyVisits = 0
        func admittedText(_ element: AXUIElement) -> (String, CGRect)? {
            guard let bounds = rectangle(element), bounds.width >= 4, bounds.height >= 4,
                  viewport.contains(bounds) else { return nil }
            var hit: AXUIElement?
            guard AXUIElementCopyElementAtPosition(application, Float(bounds.midX), Float(bounds.midY), &hit) == .success,
                  let hit = hit, CFEqual(hit, element) else { return nil }
            return (string(element, "AXValue"), bounds)
        }
        // Assemble only a bounded inline subtree; every leaf must pass admission.
        // A clipped leaf or an AX hit owned by another element rejects the group.
        // AX-hidden overlays are not proof of pixel occlusion (see the study).
        // Never join neighboring blocks/columns, inputs, controls or iframes.
        func assemble(_ element: AXUIElement, _ depth: Int) -> (String, CGRect)? {
            guard depth < 5, assemblyVisits < 600 else { return nil }
            assemblyVisits += 1
            let role = string(element, "AXRole")
            if role == "AXStaticText" { return admittedText(element) }
            let subrole = string(element, "AXSubrole")
            let inlineStyles: Set<String> = ["AXCodeStyleGroup", "AXStrongStyleGroup", "AXEmphasisStyleGroup"]
            guard role == "AXLink" || role == "AXHeading" || (role == "AXGroup" && inlineStyles.contains(subrole)),
                  let children = attribute(element, "AXChildren") as? [AXUIElement], !children.isEmpty,
                  children.count <= 64 else { return nil }
            var text = ""; var bounds = CGRect.null; var previous: CGRect?
            for child in children {
                guard let part = assemble(child, depth + 1), text.utf16.count + part.0.utf16.count <= 2048 else { return nil }
                if let last = previous, !text.isEmpty, text.last?.isWhitespace == false,
                   part.0.first?.isWhitespace == false,
                   (part.1.minY >= last.maxY - 2 || part.1.minX >= last.maxX + 3) { text += " " }
                text += part.0; bounds = bounds.union(part.1); previous = part.1
            }
            return (text, bounds)
        }
        func block(_ element: AXUIElement) -> (String, CGRect)? {
            guard let children = attribute(element, "AXChildren") as? [AXUIElement], !children.isEmpty,
                  children.count <= 64 else { return nil }
            // Check shape before accessing text, so a large layout wrapper is
            // not mistaken for a paragraph and does not consume text budget.
            for child in children {
                let role = string(child, "AXRole"), subrole = string(child, "AXSubrole")
                guard role == "AXStaticText" || role == "AXLink" ||
                    (role == "AXGroup" && ["AXCodeStyleGroup", "AXStrongStyleGroup", "AXEmphasisStyleGroup"].contains(subrole)) else { return nil }
            }
            var text = ""; var bounds = CGRect.null; var previous: CGRect?
            for child in children {
                guard let part = assemble(child, 0), text.utf16.count + part.0.utf16.count <= 2048 else { return nil }
                if let last = previous, !text.isEmpty, text.last?.isWhitespace == false,
                   part.0.first?.isWhitespace == false,
                   (part.1.minY >= last.maxY - 2 || part.1.minX >= last.maxX + 3) { text += " " }
                text += part.0; bounds = bounds.union(part.1); previous = part.1
            }
            return (text, bounds)
        }
        func walk(_ index: Int, _ depth: Int, _ heading: Bool) {
            guard depth < 24, visited < 8192 else { incomplete = true; return }
            visited += 1
            let node = plan[index]
            guard node.possibleText else { return }
            let element = node.element
            // Fresh role/subrole before any text path. No plan persists between samples.
            let (role, subrole, currentChildren, _) = shape(element)
            let expectedChildren = node.children.map { plan[$0].element }
            guard role == node.role, subrole == node.subrole,
                  (currentChildren ?? []).count == expectedChildren.count,
                  zip(currentChildren ?? [], expectedChildren).allSatisfy({ CFEqual($0.0, $0.1) }) else { incomplete = true; return }
            if inputRoles.contains(role) || (role == "AXWebArea" && !CFEqual(element, area)) { return }
            if excludedLandmarks.contains(subrole) { return }
            let isHeading = heading || role == "AXHeading"
            if role == "AXHeading" || (role == "AXGroup" && subrole.isEmpty) {
                if let part = block(element) {
                    chunks.append(Chunk(raw: part.0, bounds: part.1, heading: isHeading, ordinal: chunks.count)); return
                }
            }
            if role == "AXStaticText" {
                if let part = admittedText(element) { chunks.append(Chunk(raw: part.0, bounds: part.1, heading: isHeading, ordinal: chunks.count)) }
                return
            }
            for child in node.children { walk(child, depth + 1, isHeading) }
        }
        for root in mains.isEmpty ? [areaIndex] : mains { walk(root, 0, false) }
        // Prefer earlier screen blocks over AX traversal order (a floated code
        // example can precede the explanatory prose in the native tree).
        chunks.sort {
            if $0.bounds.minY != $1.bounds.minY { return $0.bounds.minY < $1.bounds.minY }
            if $0.bounds.minX != $1.bounds.minX { return $0.bounds.minX < $1.bounds.minX }
            return $0.ordinal < $1.ordinal
        }
        for chunk in chunks {
            let value = clean(chunk.raw, chunk.heading ? 80 : 120)
            if !value.isEmpty, !title.contains(value.lowercased()), !headings.contains(value), !topic.contains(value) {
                if chunk.heading && headings.count < 3 { headings.append(value) }
                else if !chunk.heading && topic.count < 4 {
                    let remaining = 240 - topic.reduce(0) { $0 + $1.utf16.count }
                    let bounded = clean(value, remaining)
                    if !bounded.isEmpty, !topic.contains(bounded) { topic.append(bounded) }
                }
            }
        }
        guard !incomplete, !changes.invalidated, !headings.isEmpty || !topic.isEmpty,
              let after = scriptingIdentity(), after == before,
              NSWorkspace.shared.frontmostApplication?.processIdentifier == pid, birth() == processBirth,
              let finalWindow = attribute(application, "AXFocusedWindow"), CFEqual(finalWindow, window),
              string(window, "AXTitle") == nativeTitle, nativeWindowID(windowBounds) == windowID,
              rectangle(window) == windowBounds, areaURL() == before.url else { return nil }
        var description: String?
        let descriptionCap = min(160, max(0, 240-headings.reduce(0) { $0+$1.utf16.count }))
        let readerUntil = deadline-0.15 // Preserve time for a second native identity check.
        if CommandLine.arguments.count == 8, CommandLine.arguments[7] == "--description-stdio",
           descriptionCap > 0, url.scheme == "https", readerUntil-ProcessInfo.processInfo.systemUptime > 0.06 {
            var baseline: [String: Any] = [:]
            if !headings.isEmpty { baseline["headings"] = headings }
            if !topic.isEmpty { baseline["visibleTopic"] = topic }
            let request: [String: Any] = ["phase": "description", "version": 1, "pid": Int(pid),
                "bundleId": CommandLine.arguments[3], "pageUrl": before.url, "pageTitle": before.tabTitle,
                "clues": baseline, "lookupBudgetMs": max(1, Int((readerUntil-ProcessInfo.processInfo.systemUptime)*1000))]
            guard let data = try? JSONSerialization.data(withJSONObject: request) else { return nil }
            print(String(decoding: data, as: UTF8.self)); fflush(stdout)
            if let text = readDescriptionReply(deadline: readerUntil, valid: { !changes.invalidated }) {
                description = clean(text, descriptionCap)
            }
            // Changes during lookup (including ABA) invalidate this whole sample.
            guard !changes.invalidated, let afterLookup = scriptingIdentity(), afterLookup == before,
                  NSWorkspace.shared.frontmostApplication?.processIdentifier == pid, birth() == processBirth,
                  let finalWindow = attribute(application, "AXFocusedWindow"), CFEqual(finalWindow, window),
                  string(window, "AXTitle") == nativeTitle, rectangle(window) == windowBounds,
                  nativeWindowID(windowBounds) == windowID, areaURL() == before.url else { return nil }
        }
        pump()
        guard !changes.invalidated, ProcessInfo.processInfo.systemUptime < deadline else { return nil }
        var clues: [String: Any] = [:]
        if let description = description, !description.isEmpty { clues["description"] = description }
        if !headings.isEmpty { clues["headings"] = headings }
        if !topic.isEmpty { clues["visibleTopic"] = topic }
        return ["version": 1, "pid": Int(pid), "bundleId": CommandLine.arguments[3], "pageUrl": before.url, "pageTitle": before.tabTitle, "clues": clues]
    }
    if let result = sample(), let data = try? JSONSerialization.data(withJSONObject: result) { print(String(decoding: data, as: UTF8.self)) }
    else { print("null") }
    exit(0)
}

// Onefile Python has one extra loader process. Resolve only our actual parent
// chain from the kernel, accepting at most one identical frozen executable.
// Never trust an environment PID or search arbitrary browser ancestors.
if [3, 4].contains(CommandLine.arguments.count), CommandLine.arguments[1] == "--native-browser-parent" {
    func parentOf(_ pid: Int32) -> Int32? {
        var info = proc_bsdinfo()
        let size = Int32(MemoryLayout<proc_bsdinfo>.size)
        guard proc_pidinfo(pid, PROC_PIDTBSDINFO, 0, &info, size) == size,
              info.pbi_ppid > 1 else { return nil }
        return Int32(info.pbi_ppid)
    }
    func executableOf(_ pid: Int32) -> String? {
        // PROC_PIDPATHINFO_MAXSIZE is a C expression unavailable to Swift.
        var buffer = [CChar](repeating: 0, count: 4 * Int(MAXPATHLEN))
        guard proc_pidpath(pid, &buffer, UInt32(buffer.count)) > 0 else { return nil }
        return URL(fileURLWithPath: String(cString: buffer)).resolvingSymlinksInPath().path
    }
    guard let host = Int32(CommandLine.arguments[2]), host == getppid(),
          var browser = parentOf(host) else { exit(1) }
    if CommandLine.arguments.count == 4 {
        let expected = URL(fileURLWithPath: CommandLine.arguments[3]).resolvingSymlinksInPath().path
        guard executableOf(host) == expected else { exit(1) }
        if executableOf(browser) == expected {
            guard let outer = parentOf(browser) else { exit(1) }
            browser = outer
        }
    }
    let allowed = ["com.google.Chrome", "com.google.Chrome.canary", "com.google.Chrome.forTesting", "com.google.chrome.for.testing", "org.chromium.Chromium", "com.microsoft.edgemac", "com.brave.Browser"]
    guard let app = NSRunningApplication(processIdentifier: browser),
          !app.isTerminated, let bundle = app.bundleIdentifier, allowed.contains(bundle),
          let data = try? JSONSerialization.data(withJSONObject: ["browserPid": Int(browser)]) else { exit(1) }
    print(String(decoding: data, as: UTF8.self))
    exit(0)
}

// Browser context owns one persistent identity monitor per native-messaging port.
// It reports only the declared browser PID, process birth time and window geometry.
if CommandLine.arguments.count == 3, CommandLine.arguments[1] == "--browser-owner-monitor",
   let pid = Int32(CommandLine.arguments[2]), pid > 0 {
var focusRevision = 0
var windowRevision = 0
var previousWindows = ""
func windows() -> [[String: Any]] {
    let rows = CGWindowListCopyWindowInfo([.optionOnScreenOnly, .excludeDesktopElements], kCGNullWindowID) as? [[String: Any]] ?? []
    return rows.compactMap { r in
        guard (r[kCGWindowOwnerPID as String] as? NSNumber)?.int32Value == pid,
              (r[kCGWindowLayer as String] as? NSNumber)?.intValue == 0,
              let id = r[kCGWindowNumber as String] as? NSNumber,
              let b = r[kCGWindowBounds as String] as? [String: Any],
              let x = b["X"] as? NSNumber, let y = b["Y"] as? NSNumber,
              let width = b["Width"] as? NSNumber, let height = b["Height"] as? NSNumber else { return nil }
        return ["id": id, "left": x, "top": y, "width": width, "height": height]
    }
}
func snapshot() -> [String: Any] {
    let w = windows()
    let signature = String(data: (try? JSONSerialization.data(withJSONObject: w, options: .sortedKeys)) ?? Data(), encoding: .utf8) ?? ""
    if previousWindows != "" && signature != previousWindows { windowRevision += 1 }
    previousWindows = signature
    let app = NSRunningApplication(processIdentifier: pid)
    // launchDate can be nil for a directly executed app. Read kernel birth time
    // for only the declared owned PID; discard the remaining BSD process fields.
    var info = proc_bsdinfo()
    let size = Int32(MemoryLayout<proc_bsdinfo>.size)
    let read = proc_pidinfo(pid, PROC_PIDTBSDINFO, 0, &info, size)
    let birth: Double? = read == size && info.pbi_start_tvsec > 0
        ? Double(info.pbi_start_tvsec) + Double(info.pbi_start_tvusec) / 1_000_000 : nil
    return ["pid": Int(pid), "bundleId": app?.bundleIdentifier as Any? ?? NSNull(), "processAlive": birth != nil && app?.isTerminated != true,
            "processLaunchTime": birth as Any? ?? NSNull(),
            "frontmostOwned": NSWorkspace.shared.frontmostApplication?.processIdentifier == pid,
            "focusRevision": focusRevision, "windowRevision": windowRevision, "windows": w]
}
_ = NSWorkspace.shared.notificationCenter.addObserver(forName: NSWorkspace.didActivateApplicationNotification, object: nil, queue: .main) { _ in focusRevision += 1 }
_ = Timer.scheduledTimer(withTimeInterval: 0.1, repeats: true) { _ in _ = snapshot() }
DispatchQueue.global().async {
    while readLine() != nil {
        DispatchQueue.main.async {
            if let d = try? JSONSerialization.data(withJSONObject: snapshot(), options: .sortedKeys), let s = String(data: d, encoding: .utf8) {
                print(s); fflush(stdout)
            }
        }
    }
    DispatchQueue.main.async { exit(0) }
}
RunLoop.main.run()

}

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
