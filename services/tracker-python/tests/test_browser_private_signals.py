"""Private-window decisions for macOS page clues (owner decision 2026-10-13).

Only a window positively identified as private withholds clues; an unknown
private state counts as normal. Values are the ones observed in Safari 26.6,
Dia 1.52 and Chromium browsers on macOS 26 (docs/research V36).
"""
import json
import shutil
import subprocess
import sys
import tempfile
import unittest
from pathlib import Path

PAGE = 'asyncio \u2014 Asynchronous I/O \u2014 Python 3.15.0 documentation'


@unittest.skipUnless(sys.platform == 'darwin' and shutil.which('xcrun'), 'macOS Swift helper')
class BrowserPrivateSignalTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.temp = tempfile.TemporaryDirectory()
        root = Path(cls.temp.name)
        product = Path(__file__).parents[1] / 'app/tracker/chatgpt_session_ax.swift'
        library = product.read_text().split('// Browser-owned scripting metadata admits', 1)[0]
        source = root / 'signals.swift'
        source.write_text(library + '''
let request = try! JSONSerialization.jsonObject(with: FileHandle.standardInput.readDataToEndOfFile()) as! [String: Any]
var output: [Bool] = []
for mode in request["modes"] as? [Any] ?? [] { output.append(scriptedWindowModeAllowsClues(mode as? String)) }
for c in request["safari"] as? [[String: Any]] ?? [] {
    output.append(safariWindowAllowsClues(windowTitle: c["window"] as! String, pageTitle: c["page"] as! String,
        normalProof: c["normal"] as! Bool, privateGroup: c["privateGroup"] as! Bool))
}
for c in request["dia"] as? [[String] ] ?? [] { output.append(diaWindowAllowsClues(identifier: c[0], windowID: c[1])) }
print(String(decoding: try! JSONSerialization.data(withJSONObject: output), as: UTF8.self))
''')
        cls.helper = root / 'signals'
        subprocess.run(['xcrun', 'swiftc', '-O', str(source), '-o', str(cls.helper)], check=True, capture_output=True, timeout=120)

    @classmethod
    def tearDownClass(cls):
        cls.temp.cleanup()

    def run_helper(self, **request):
        output = subprocess.run([str(self.helper)], input=json.dumps(request), capture_output=True, text=True, check=True, timeout=10).stdout
        return json.loads(output)

    def test_chromium_rejects_only_a_reported_private_mode(self):
        self.assertEqual(self.run_helper(modes=['normal', None, 'incognito', 'guest']), [True, True, False, False])

    def test_safari_private_title_label_rejects_in_any_language_without_toolbar_proof(self):
        def case(window, page=PAGE, normal=False, private_group=False):
            return {'window': window, 'page': page, 'normal': normal, 'privateGroup': private_group}
        self.assertEqual(self.run_helper(safari=[
            case(PAGE),                                      # normal window, toolbar picker not readable
            case(PAGE, normal=True),                         # normal window with the picker
            case(PAGE + ', Private Browsing'),               # English private window
            case(PAGE + ', \uac1c\uc778\uc815\ubcf4 \ubcf4\ud638 \ube0c\ub77c\uc6b0\uc9d5'),  # Korean private window
            case(PAGE, normal=True, private_group=True),     # sidebar shows a private tab group
            case('docs.python.org', page=''),                # untitled page: unknown, allowed
        ]), [True, True, False, False, False, True])

    def test_dia_binds_the_window_id_and_rejects_the_incognito_marker(self):
        window = 'B5A64553-77BA-44D2-8D3F-49AD0DAE6FBA'
        self.assertEqual(self.run_helper(dia=[
            ['bigBrowserWindow_' + window, window],
            ['bigIncognitoBrowserWindow_' + window, window],
            ['bigBrowserWindow_07EACB0F-144B-44B5-8F31-11F325B373E4', window],
            ['renamedWindow_' + window, window],
            ['bigBrowserWindow_', ''],
        ]), [True, False, False, True, False])


if __name__ == '__main__':
    unittest.main()
