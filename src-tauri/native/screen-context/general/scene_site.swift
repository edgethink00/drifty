import Foundation

// Chromium draws parts of its own interface as web pages on the browser-UI
// domain top-chrome (kChromeUITopChromeDomain): the address bar's suggestion
// list while the address is edited, and side panels such as the reading list
// (measured Chrome 158 on macOS). A tab never shows them, so they are not the
// window's page. Any other extra web area still makes the page ambiguous.
func isBrowserInterfacePage(_ value: CFTypeRef?) -> Bool {
    guard let url = (value as? URL) ?? (value as? String).flatMap(URL.init(string:)),
          ["chrome", "chrome-untrusted"].contains(url.scheme?.lowercased() ?? ""),
          let host = url.host?.lowercased() else { return false }
    return host.hasSuffix(".top-chrome")
}

// Foundation URL canonicalizes IDN hosts to ASCII. Keep only a bounded hostname;
// URL paths, credentials and ports never enter scene metadata.
func sceneSiteHost(_ url: URL) -> String? {
    guard ["http", "https"].contains(url.scheme?.lowercased() ?? ""),
          var host = url.host?.lowercased() else { return nil }
    while host.hasSuffix(".") { host.removeLast() }
    if host.hasPrefix("www.") { host.removeFirst(4) }
    let labels = host.split(separator: ".", omittingEmptySubsequences: false)
    guard host.utf8.count <= 253, labels.count >= 2,
        labels.allSatisfy({ label in
            !label.isEmpty && label.utf8.count <= 63 && !label.hasPrefix("-") && !label.hasSuffix("-")
            && label.utf8.allSatisfy { (97...122).contains($0) || (48...57).contains($0) || $0 == 45 }
        }) else { return nil }
    return host
}
