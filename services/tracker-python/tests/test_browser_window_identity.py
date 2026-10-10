"""Chromium native window identity observed in Chrome, Edge and Brave on macOS 14 (English and Korean UI)."""
import json
import shutil
import subprocess
import sys
import tempfile
import unittest
from pathlib import Path

TAB = 'Introduction to Algorithms | Electrical Engineering and Computer Science | MIT OpenCourseWare'
WINDOW = [44, 69, 1200, 910]


@unittest.skipUnless(sys.platform == 'darwin' and shutil.which('xcrun'), 'macOS Swift helper')
class ChromiumWindowIdentityTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.temp = tempfile.TemporaryDirectory()
        root = Path(cls.temp.name)
        product = Path(__file__).parents[1] / 'app/tracker/chatgpt_session_ax.swift'
        library = product.read_text().split('// Browser-owned scripting metadata admits', 1)[0]
        source = root / 'identity.swift'
        source.write_text(library + '''
let request = try! JSONSerialization.jsonObject(with: FileHandle.standardInput.readDataToEndOfFile()) as! [String: Any]
func rect(_ value: Any?) -> CGRect? {
    guard let v = value as? [Double] else { return nil }
    return CGRect(x: v[0], y: v[1], width: v[2], height: v[3])
}
var output: [Any] = []
for title in request["titles"] as? [[String]] ?? [] { output.append(chromiumWindowTitleMatches(title[0], tabTitle: title[1])) }
for stack in request["stacks"] as? [[String: Any]] ?? [] {
    let rows = (stack["rows"] as! [[String: Any]]).map { (number: $0["n"] as? Int, bounds: rect($0["b"])) }
    output.append(chromiumFrontWindowNumber(rows, matching: rect(stack["target"])!) ?? -1)
}
print(String(decoding: try! JSONSerialization.data(withJSONObject: output), as: UTF8.self))
''')
        cls.helper = root / 'identity'
        subprocess.run(['xcrun', 'swiftc', '-O', str(source), '-o', str(cls.helper)], check=True, capture_output=True, timeout=120)

    @classmethod
    def tearDownClass(cls):
        cls.temp.cleanup()

    def run_helper(self, titles=(), stacks=()):
        request = json.dumps({'titles': list(titles), 'stacks': list(stacks)})
        output = subprocess.run([str(self.helper)], input=request, capture_output=True, text=True, check=True, timeout=10).stdout
        return json.loads(output)

    def test_accepts_brand_and_profile_labels_in_english_and_korean(self):
        observed = [
            TAB,
            TAB + ' - Google Chrome',
            TAB + ' - Microsoft Edge',
            TAB + ' - Brave',
            TAB + ' - Google Chrome - Person 1',
            TAB + ' - Microsoft Edge - Profile 2',
            TAB + ' - Chrome',
            TAB + ' - Chrome - 사용자 이름 1',
            TAB + ' - Chrome - 내 Chrome',
            TAB + ' - Microsoft Edge - 프로필 2',
            TAB + ' - Brave - 사용자 이름 1',
            TAB + ' - Brave - 개인',
            TAB + ' - Chrome - Work (2026)',
        ]
        self.assertEqual(self.run_helper(titles=[[title, TAB] for title in observed]), [True] * len(observed))

    def test_rejects_private_labels_other_titles_and_partial_prefixes(self):
        cases = [
            [TAB + ' - Google Chrome (Incognito)', TAB],
            [TAB + ' - Microsoft Edge (InPrivate)', TAB],
            [TAB + ' - Brave (Private)', TAB],
            [TAB + ' - Chrome (시크릿 모드)', TAB],
            [TAB + ' - Brave (시크릿)', TAB],
            [TAB + ' - Chrome (시크릿 모드) - 사용자 이름 1', TAB],
            ['Promise - JavaScript | MDN - Google Chrome', TAB],
            [TAB + ' extra - Google Chrome', TAB],
            ['Course - Google Chrome', 'Course Info'],
            ['Prefix ' + TAB + ' - Brave', TAB],
            [TAB + ' - ', TAB],
            ['', TAB],
            [' - Google Chrome', ''],
        ]
        self.assertEqual(self.run_helper(titles=cases), [False] * len(cases))

    def test_window_stack_allows_bubbles_inside_the_browser_window_only(self):
        translate_front = {'n': 114, 'b': [922, 149, 237, 87]}
        older_bubble = {'n': 108, 'b': [900, 127, 237, 87]}
        older_window = {'n': 99, 'b': [22, 47, 1200, 910]}
        stacks = [
            # Korean Chrome with the translate offer in front of the window (observed).
            {'target': WINDOW, 'rows': [translate_front, {'n': 109, 'b': WINDOW}, older_bubble, older_window]},
            {'target': WINDOW, 'rows': [{'n': 109, 'b': WINDOW}, older_window]},
            # The older window is covered by a window that is not inside it.
            {'target': [22, 47, 1200, 910], 'rows': [translate_front, {'n': 109, 'b': WINDOW}, older_bubble, older_window]},
            # Two windows with the same bounds are ambiguous.
            {'target': WINDOW, 'rows': [{'n': 1, 'b': WINDOW}, {'n': 2, 'b': [45, 70, 1200, 910]}]},
            # A covering row without bounds or partly outside the window blocks it.
            {'target': WINDOW, 'rows': [{'n': 7}, {'n': 109, 'b': WINDOW}]},
            {'target': WINDOW, 'rows': [{'n': 7, 'b': [1100, 100, 300, 80]}, {'n': 109, 'b': WINDOW}]},
            {'target': WINDOW, 'rows': [older_window]},
        ]
        self.assertEqual(self.run_helper(stacks=stacks), [109, 109, -1, -1, -1, -1, -1])


if __name__ == '__main__':
    unittest.main()
