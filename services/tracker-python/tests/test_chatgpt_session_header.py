"""Production Swift extractor against synthetic versions of observed AX headers."""
import json
import shutil
import subprocess
import sys
import tempfile
import unittest
from pathlib import Path


@unittest.skipUnless(sys.platform == 'darwin' and shutil.which('xcrun'), 'macOS Swift helper')
class ChatGPTSessionHeaderTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.temp = tempfile.TemporaryDirectory()
        cls.addClassCleanup(cls.temp.cleanup)
        product = Path(__file__).parents[1] / 'app/tracker/chatgpt_session_ax.swift'
        text = product.read_text()
        library = text[text.index('let chrome = Set(['):text.index('// End session-header extraction.')]
        source = Path(cls.temp.name) / 'header.swift'
        source.write_text('import Foundation\n' + library + '''
struct Node: Decodable { let role: String; let title: String?; let value: String?; let children: [Node]? }
let headers = try JSONDecoder().decode([Node].self, from: FileHandle.standardInput.readDataToEndOfFile())
let result = headers.map { node in sessionHeaderThread(node, children: { $0.children ?? [] }, role: { $0.role }, title: { $0.title ?? "" }, value: { $0.value ?? "" }) ?? "" }
print(String(decoding: try JSONEncoder().encode(result), as: UTF8.self))
''')
        cls.helper = Path(cls.temp.name) / 'header'
        subprocess.run(['xcrun', 'swiftc', '-O', str(source), '-o', str(cls.helper)], check=True, capture_output=True, timeout=60)

    def extract(self, nodes):
        result = subprocess.run([str(self.helper)], input=json.dumps(nodes), text=True, capture_output=True, check=True, timeout=5)
        return json.loads(result.stdout)

    def test_old_buttons_and_current_toolbar_text(self):
        old = dict(role='AXGroup', children=[dict(role='AXButton', title='Fix synthetic bug'), dict(role='AXButton', title='New chat')])
        current = dict(role='AXToolbar', children=[dict(role='AXImage', title='Project: synthetic'), dict(role='AXGroup', children=[dict(role='AXStaticText', value='현재 제목')]), dict(role='AXGroup', children=[dict(role='AXPopUpButton', title='Local')])])
        self.assertEqual(self.extract([old, current]), ['Fix synthetic bug', '현재 제목'])

    def test_missing_ambiguous_or_unrelated_text_fails_closed(self):
        text = dict(role='AXStaticText', value='Conversation content')
        headers = [dict(role='AXToolbar'), dict(role='AXToolbar', children=[text, text]), dict(role='AXGroup', children=[text]), dict(role='AXToolbar', children=[dict(role='AXStaticText', value='ChatGPT')]), dict(role='AXGroup', children=[dict(role='AXButton', title='Close tab')])]
        self.assertEqual(self.extract(headers), [''] * len(headers))
