#!/usr/bin/env python3
"""Check window matching, document identity, page clipping and Chrome's interface pages with synthetic values; no desktop access."""
import argparse
from pathlib import Path
import subprocess

parser = argparse.ArgumentParser(description=__doc__)
parser.add_argument('--artifacts', type=Path, required=True)
args = parser.parse_args()
args.artifacts.mkdir(parents=True, mode=0o700)
source = (Path(__file__).parents[1] / 'macos.swift').read_text()
site_source = (Path(__file__).parents[1] / 'general' / 'scene_site.swift').read_text()


def function(name, text=source):
    start = text.index('func ' + name + '(')
    return text[start:text.index('\n}\n', start) + 3]


driver = r'''
func check(_ label: String, _ got: Bool, _ want: Bool) {
    guard got == want else { print("FAIL \(label): \(got) != \(want)"); exit(1) }
}
func check(_ label: String, _ got: CGRect?, _ want: CGRect?) {
    guard got == want else { print("FAIL \(label): \(String(describing: got)) != \(String(describing: want))"); exit(1) }
}
// Apps other than browsers keep the exact match.
check("exact", windowNameMatches("Notes.txt", title: "Notes.txt", browser: false), true)
check("app suffix", windowNameMatches("Notes.txt", title: "Notes.txt - Editor", browser: false), false)
// Chrome names the accessibility window "<page> - Google Chrome", with profile or channel after it.
check("chrome", windowNameMatches("Release notes", title: "Release notes - Google Chrome", browser: true), true)
check("profile", windowNameMatches("Release notes", title: "Release notes - Google Chrome - Work", browser: true), true)
check("browser exact", windowNameMatches("Release notes", title: "Release notes", browser: true), true)
// A different page, a bare prefix, an empty or missing name never match.
check("other page", windowNameMatches("Release", title: "Release notes - Google Chrome", browser: true), false)
check("empty", windowNameMatches("", title: " - Google Chrome", browser: true), false)
check("missing", windowNameMatches(nil, title: "Release notes - Google Chrome", browser: true), false)

// TextEdit and Preview must name a document. Any other app may lack one.
struct NoDocument: Error {}
func named() throws -> String { "file:///Users/qa/Plan.rtf" }
func none() throws -> String { throw NoDocument() }
check("textedit named", (try? windowDocument(bundle: "com.apple.TextEdit", pinned: false, read: named)) == "file:///Users/qa/Plan.rtf", true)
check("textedit without", (try? windowDocument(bundle: "com.apple.TextEdit", pinned: false, read: none)) == nil, true)
check("any app without", (try? windowDocument(bundle: "notion.id", pinned: false, read: none)) == .some(nil), true)
check("any app named", (try? windowDocument(bundle: "com.microsoft.Word", pinned: false, read: named)) == "file:///Users/qa/Plan.rtf", true)
check("pinned ignores", (try? windowDocument(bundle: "com.tinyspeck.slackmacgap", pinned: true, read: named)) == .some(nil), true)

// The page area below the tab strip and address bar, rounded inward.
let window = CGRect(x: 60, y: 70, width: 600, height: 520)
check("page", browserPageClip(window, page: CGRect(x: 60, y: 157.5, width: 600, height: 432.5)),
      CGRect(x: 60, y: 158, width: 600, height: 432))
// A Dock clip already applied stays applied.
check("dock", browserPageClip(CGRect(x: 60, y: 70, width: 600, height: 400), page: CGRect(x: 60, y: 158, width: 600, height: 432)),
      CGRect(x: 60, y: 158, width: 600, height: 312))
// A page outside the visible part, or a sliver of one, refuses.
check("outside", browserPageClip(window, page: CGRect(x: 700, y: 158, width: 300, height: 300)), nil)
check("sliver", browserPageClip(window, page: CGRect(x: 60, y: 570, width: 600, height: 300)), nil)

// Chrome's own interface pages on the top-chrome domain are not the window's
// page, whether the accessibility value is a URL or a string.
check("suggestions", isBrowserInterfacePage(URL(string: "chrome://omnibox-popup.top-chrome/") as CFTypeRef?), true)
check("side panel", isBrowserInterfacePage("chrome://read-later.top-chrome/" as CFString), true)
check("untrusted panel", isBrowserInterfacePage(URL(string: "chrome-untrusted://read-anything-side-panel.top-chrome/") as CFTypeRef?), true)
// A page a tab can show, or a lookalike outside Chrome's schemes, is still a page.
check("web page", isBrowserInterfacePage(URL(string: "https://docs.example.test/") as CFTypeRef?), false)
check("web lookalike", isBrowserInterfacePage(URL(string: "https://evil.top-chrome/") as CFTypeRef?), false)
check("settings tab", isBrowserInterfacePage(URL(string: "chrome://settings/") as CFTypeRef?), false)
check("suffix only", isBrowserInterfacePage(URL(string: "chrome://top-chrome/") as CFTypeRef?), false)
check("missing", isBrowserInterfacePage(nil), false)
print("ok")
'''
program = args.artifacts / 'browser_window.swift'
program.write_text('import CoreGraphics\nimport Foundation\n' + function('windowNameMatches') + function('windowDocument')
                   + function('browserPageClip') + function('isBrowserInterfacePage', site_source) + driver)
binary = args.artifacts / 'browser_window'
subprocess.run(['xcrun', 'swiftc', '-O', str(program), '-o', str(binary)], check=True)
result = subprocess.run([str(binary)], capture_output=True, text=True)
print(result.stdout, end='')
raise SystemExit(result.returncode)
