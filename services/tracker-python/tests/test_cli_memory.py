from __future__ import annotations
import json
import os
from pathlib import Path
import socket
import tempfile
import threading
import unittest
import sys
sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from app.cli.memory import call_memory
from app.cli.mcp import handle_message


@unittest.skipUnless(hasattr(socket, 'AF_UNIX'), 'Unix memory transport')
class MemoryProxyTests(unittest.TestCase):
    def test_no_endpoint_has_only_existing_tools(self):
        request = {'jsonrpc': '2.0', 'id': 1, 'method': 'tools/list'}
        normal = handle_message(request, Path('/unused'), 'safe')
        memory = handle_message(request, Path('/unused'), 'safe', Path('/private/turn.sock'))
        self.assertEqual(len(normal['result']['tools']), 3)
        self.assertEqual([t['name'] for t in memory['result']['tools']][-4:], ['memory_recent', 'memory_search', 'memory_source', 'memory_wiki'])
        self.assertTrue(call_memory(None, 'memory_search', {'query': 'Atlas'})['isError'])

    def test_private_socket_reads_one_bounded_observation(self):
        # macOS Unix socket names are short; tempfile's default path is too long.
        with tempfile.TemporaryDirectory(dir='/tmp', prefix='dm-') as raw:
            root = Path(raw); root.chmod(0o700); path = root/'s'
            with socket.socket(socket.AF_UNIX, socket.SOCK_STREAM) as server:
                server.bind(str(path)); path.chmod(0o600); server.listen(1)
                received = []
                def respond():
                    with server.accept()[0] as client:
                        received.append(json.loads(client.makefile('rb').readline()))
                        client.sendall(b'{"ok":true,"result":{"text":"owned observation"}}\n')
                thread = threading.Thread(target=respond); thread.start()
                result = call_memory(path, 'memory_source', {'id': 'owned'})
                thread.join(2)
                self.assertFalse(result['isError'])
                self.assertEqual(result['structuredContent']['kind'], 'observed_memory')
                self.assertEqual(received, [{'name': 'memory_source', 'arguments': {'id': 'owned'}}])
                root.chmod(0o755)
                self.assertTrue(call_memory(path, 'memory_source', {'id': 'owned'})['isError'])

    def test_agent_cannot_write_or_select_its_scope(self):
        for name, args in [('memory_recent', {'scope': 'other'}), ('purge', {}), ('memory_search', {'query': 'Atlas', 'scope': 'other'}),
                           ('memory_search', {'query': ' '}), ('memory_source', {'id': '../other'}),
                           ('memory_wiki', {'page': ''}), ('memory_wiki', {'page': 'x' * 201}), ('memory_wiki', {'scope': 'other'}),
                           ('memory_wiki', {'page': 'Juniper', 'id': 'x'})]:
            self.assertTrue(call_memory(None, name, args)['isError'])
