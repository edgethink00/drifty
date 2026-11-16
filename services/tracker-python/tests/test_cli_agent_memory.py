from __future__ import annotations
import json
import os
from pathlib import Path
import socket
import sys
import tempfile
import threading
import unittest
sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from app.cli.main import execute_arguments
from app.cli.memory import agent_socket, read_agent_memory


@unittest.skipUnless(hasattr(socket, 'AF_UNIX'), 'Unix memory transport')
class AgentMemoryCliTests(unittest.TestCase):
    def serve(self, reply: bytes, received: list):
        # macOS Unix socket names are short; tempfile's default path is too long.
        raw = tempfile.TemporaryDirectory(dir='/tmp', prefix='da-')
        self.addCleanup(raw.cleanup)
        root = Path(raw.name); root.chmod(0o700); path = root / 's'
        server = socket.socket(socket.AF_UNIX, socket.SOCK_STREAM)
        self.addCleanup(server.close)
        server.bind(str(path)); path.chmod(0o600); server.listen(1)

        def respond():
            with server.accept()[0] as client:
                received.append(json.loads(client.makefile('rb').readline()))
                client.sendall(reply)
        thread = threading.Thread(target=respond, daemon=True); thread.start()
        self.addCleanup(thread.join, 2)
        return path

    def test_fixed_socket_is_per_user(self):
        self.assertEqual(agent_socket(), Path(f'/tmp/drifty-memory-agent-{os.getuid()}/agent.sock'))

    def test_search_returns_observed_memory_envelope(self):
        received = []
        path = self.serve(b'{"ok":true,"result":{"facts":[{"text":"Kestrel ships Friday"}]}}\n', received)
        result, code = execute_arguments(['memory', 'search', '--query', 'Kestrel', '--socket', str(path)])
        self.assertEqual(code, 0)
        self.assertEqual(received, [{'name': 'memory_search', 'arguments': {'query': 'Kestrel'}}])
        self.assertEqual(result['command'], 'memory')
        self.assertEqual(result['query'], {'operation': 'search', 'text': 'Kestrel'})
        self.assertEqual(result['data']['facts'][0]['text'], 'Kestrel ships Friday')
        self.assertEqual(result['warnings'][0]['code'], 'observed_memory')

    def test_each_operation_sends_only_its_own_argument(self):
        for argv, expected in [(['recent'], ('memory_recent', {})), (['wiki'], ('memory_wiki', {})),
                               (['wiki', '--page', 'Kestrel'], ('memory_wiki', {'page': 'Kestrel'})),
                               (['source', '--id', 'abc'], ('memory_source', {'id': 'abc'}))]:
            received = []
            path = self.serve(b'{"ok":true,"result":{}}\n', received)
            _, code = execute_arguments(['memory', *argv, '--socket', str(path)])
            self.assertEqual(code, 0)
            self.assertEqual(received, [{'name': expected[0], 'arguments': expected[1]}])

    def test_memory_off_and_closed_app_are_typed(self):
        path = self.serve(b'{"ok":false,"code":"memory_off"}\n', [])
        result, code = execute_arguments(['memory', 'recent', '--socket', str(path)])
        self.assertEqual((code, result['ok'], result['error']['code']), (5, False, 'memory_off'))
        missing = Path('/tmp/da-missing-socket-for-test')
        result, code = execute_arguments(['memory', 'recent', '--socket', str(missing)])
        self.assertEqual((code, result['error']['code']), (5, 'drifty_not_running'))
        self.assertEqual(read_agent_memory(None, 'memory_recent', {}), ('memory_unavailable', None))

    def test_socket_others_can_reach_is_refused(self):
        received = []
        path = self.serve(b'{"ok":true,"result":{}}\n', received)
        path.parent.chmod(0o755)
        result, code = execute_arguments(['memory', 'recent', '--socket', str(path)])
        self.assertEqual((code, result['error']['code']), (5, 'memory_unavailable'))
        self.assertEqual(received, [])
        # Unblock the waiting test server.
        path.parent.chmod(0o700)
        with socket.socket(socket.AF_UNIX, socket.SOCK_STREAM) as client:
            client.connect(str(path)); client.sendall(b'{}\n'); client.makefile('rb').readline()

    def test_empty_or_oversized_arguments_never_reach_the_app(self):
        for argv in (['search', '--query', ' '], ['search', '--query', 'x' * 1601], ['source', '--id', 'x' * 129], ['wiki', '--page', '']):
            result, code = execute_arguments(['memory', *argv, '--socket', '/tmp/da-unused'])
            self.assertEqual((code, result['error']['code']), (2, 'invalid_arguments'))
        _, code = execute_arguments(['memory', 'purge'])
        self.assertEqual(code, 2)


if __name__ == '__main__':
    unittest.main()

