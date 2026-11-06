// Native UI facts only. Unknown privacy is admitted by owner decision 2026-11-06;
// this does not waive the independent site, identity, lock or permission checks.
import Foundation

enum SceneBrowserPrivacy: String { case normal, unknown, privateWindow = "private" }

func sceneBrowserPrivacy(appId: String, title: String, windowIdentifier: String,
                         normalProof: Bool, privateGroup: Bool, geckoPrivateIndicator: Bool) -> SceneBrowserPrivacy {
    if privateGroup || geckoPrivateIndicator || windowIdentifier.hasPrefix("bigIncognitoBrowserWindow_") {
        return .privateWindow
    }
    let safari = ["com.apple.Safari", "com.apple.SafariTechnologyPreview"].contains(appId)
    let gecko = ["org.mozilla.firefox", "org.mozilla.firefoxdeveloperedition", "app.zen-browser.zen",
                 "app.floorp.Floorp", "net.librewolf.librewolf", "net.waterfox.waterfox"].contains(appId)
    // Same measured native-window labels used by the tracker. A page merely
    // mentioning private browsing in its title is not a private-mode signal.
    let labels = safari ? ["Private Browsing", "개인정보 보호 브라우징"]
        : gecko ? ["Private Browsing", "Mozilla Firefox Private Browsing"] : []
    let separators = safari ? [", ", " — "] : [" — "]
    if labels.contains(where: { label in title == label || separators.contains { title.hasSuffix($0 + label) } }) {
        return .privateWindow
    }
    return normalProof ? .normal : .unknown
}
