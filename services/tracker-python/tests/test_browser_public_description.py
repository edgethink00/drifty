"""Real owned TLS transport: public-IP pinning, certificate checks and head limits."""
import gzip
import json
import socket
import shutil
import ssl
import subprocess
import sys
import tempfile
import threading
import time
import unittest
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from unittest.mock import patch

from app.tracker.browser_public_description import fetch_description, public_address, target


class PublicDescriptionTargetTests(unittest.TestCase):
    def test_ascii_and_unicode_hosts_match_standard_idna_results_and_rejections(self):
        hosts = ["example.com", "EXAMPLE.COM.", "localhost", "xn--bcher-kva.example", "bücher.example", "한국.example",
                 "example..com", ".example.com", ".", "a" * 63 + ".example", "a" * 64 + ".example",
                 "example." + "b" * 64, "1.2.3.4", "[2606:4700:4700::1111]"]
        hosts += [left + "." + right + dot for left in ("a", "xn--a", "_test", "a"*63, "a"*64)
                  for right in ("com", "", "b"*63, "b"*64) for dot in ("", ".")]
        from urllib.parse import urlsplit
        for host in hosts:
            with self.subTest(host=host):
                url = "https://" + host + "/course"
                parsed = urlsplit(url)
                try:
                    expected = parsed.hostname.encode("idna").decode("ascii")
                except UnicodeError:
                    with self.assertRaises(UnicodeError): target(url)
                else:
                    self.assertEqual(target(url), (parsed, expected))

    def test_ascii_target_keeps_idna_unicode_module_unloaded_in_a_fresh_reader(self):
        root = Path(__file__).parents[1]
        code = "import sys,json;sys.path.insert(0," + repr(str(root)) + ");from app.tracker.browser_public_description import target;before='encodings.idna' in sys.modules;target('https://example.com/course');print(json.dumps([before,'encodings.idna' in sys.modules]))"
        result = subprocess.run([sys.executable, "-c", code], capture_output=True, text=True, timeout=2)
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertEqual(json.loads(result.stdout), [False, False])


@unittest.skipUnless(shutil.which("openssl"), "Owned TLS fixture requires OpenSSL CLI")
class PublicDescriptionTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.directory = tempfile.TemporaryDirectory()
        root = Path(cls.directory.name)
        key, cert = root / "key.pem", root / "cert.pem"
        subprocess.run(["openssl", "req", "-x509", "-newkey", "rsa:2048", "-nodes", "-days", "1",
                        "-keyout", str(key), "-out", str(cert), "-subj", "/CN=fixture.test",
                        "-addext", "subjectAltName=DNS:fixture.test"], check=True, capture_output=True)
        cls.requests = []
        class Handler(BaseHTTPRequestHandler):
            def log_message(self, *args):
                pass
            def do_GET(self):
                cls.requests.append((self.path, dict(self.headers)))
                if self.path == "/redirect":
                    self.send_response(302); self.send_header("Location", "/normal"); self.end_headers(); return
                if self.path == "/other-host":
                    self.send_response(302); self.send_header("Location", "https://other.test/normal"); self.end_headers(); return
                if self.path == "/loop":
                    self.send_response(302); self.send_header("Location", "/loop"); self.end_headers(); return
                if self.path == "/error":
                    self.send_response(403); self.end_headers(); return
                body = b'<html><head><meta name="description" content="Public course summary"></head>'
                if self.path == "/partial":
                    body = b'<html><head><meta name="description" content="Partial summary">'
                if self.path == "/missing":
                    body = b'<html><head><title>Course</title></head>'
                if self.path == "/malformed":
                    body = b'<html><head><div><meta name="description" content="Not head metadata"></div></head>'
                if self.path == "/oversize":
                    body = b'<html><head><!--' + b'x' * 2_000_001 + b'--></head>'
                zipped = self.path in ("/gzip", "/gzip-bomb")
                if self.path == "/gzip-bomb":
                    body = b'<html><head><!--' + b'x' * 2_000_001 + b'--></head>'
                if zipped:
                    body = gzip.compress(body)
                self.send_response(200)
                self.send_header("Content-Type", "application/json" if self.path == "/json" else "text/html; charset=utf-8")
                if zipped:
                    self.send_header("Content-Encoding", "gzip")
                self.end_headers()
                try:
                    if self.path == "/slow-head":
                        time.sleep(.15)
                    self.wfile.write(body); self.wfile.flush()
                    if self.path == "/slow-body":
                        time.sleep(.3)
                        self.wfile.write(b'<body>irrelevant long body</body>')
                except (OSError, ssl.SSLError):
                    pass
        cls.server = ThreadingHTTPServer(("127.0.0.1", 0), Handler)
        tls = ssl.SSLContext(ssl.PROTOCOL_TLS_SERVER); tls.load_cert_chain(cert, key)
        cls.server.socket = tls.wrap_socket(cls.server.socket, server_side=True)
        cls.server.daemon_threads = True
        cls.thread = threading.Thread(target=cls.server.serve_forever, daemon=True); cls.thread.start()
        cls.context = ssl.create_default_context(cafile=str(cert))

    @classmethod
    def tearDownClass(cls):
        cls.server.shutdown(); cls.server.server_close(); cls.thread.join(); cls.directory.cleanup()

    def setUp(self):
        self.requests.clear()
        self.resolved = []
        self.connected = []

    def fetch(self, path="/normal", seconds=.3, *, address="8.8.8.8", context=None):
        def resolver(host, port, **kwargs):
            self.resolved.append((host, port))
            return [(socket.AF_INET, socket.SOCK_STREAM, 6, "", (address, port))]
        real_connect = socket.create_connection
        def owned_transport(destination, timeout):
            self.connected.append(destination)
            return real_connect(("127.0.0.1", self.server.server_port), timeout)
        with patch("app.tracker.browser_public_description.socket.create_connection", side_effect=owned_transport):
            return fetch_description("https://fixture.test"+path, seconds, resolver=resolver, context=context or self.context)

    def test_real_tls_pins_checked_address_preserves_host_and_has_no_credentials(self):
        self.assertEqual(self.fetch("/normal?course=2#fragment"), "Public course summary")
        self.assertEqual(self.resolved, [(b"fixture.test", 443)])
        self.assertEqual(self.connected, [(b"8.8.8.8", 443)])
        path, headers = self.requests[0]
        self.assertEqual(path, "/normal?course=2")
        self.assertEqual(headers["Host"], "fixture.test")
        self.assertFalse(any(k.lower() in {"cookie", "authorization", "proxy-authorization"} for k in headers))

    def test_certificate_validation_is_not_disabled(self):
        self.assertIsNone(self.fetch(context=ssl.create_default_context()))
        self.assertEqual(self.requests, [])

    def test_ascii_sni_keeps_hostname_checks_and_matches_the_requested_host(self):
        from app.tracker.browser_public_description import PinnedHTTPSConnection
        calls = []
        original_wrap = self.context.wrap_socket
        def wrap(sock, **kwargs):
            calls.append(kwargs["server_hostname"])
            return original_wrap(sock, **kwargs)
        with patch.object(self.context, "wrap_socket", side_effect=wrap):
            self.assertEqual(self.fetch(), "Public course summary")
        self.assertEqual(calls, [b"fixture.test"])
        self.assertTrue(self.context.check_hostname)
        self.assertEqual(self.context.verify_mode, ssl.CERT_REQUIRED)
        self.requests.clear()
        real_connect = socket.create_connection
        with patch("app.tracker.browser_public_description.socket.create_connection", side_effect=lambda *args: real_connect((b"127.0.0.1", self.server.server_port), .3)):
            # Trusted certificate, wrong hostname: rejection must precede any GET.
            self.assertIsNone(fetch_description("https://wrong.test/normal", .3,
                resolver=lambda *args, **kwargs: [(socket.AF_INET, socket.SOCK_STREAM, 6, "", ("8.8.8.8", 443))], context=self.context))
        self.assertEqual(self.requests, [])

    def test_private_and_special_addresses_never_connect(self):
        for address in ["127.0.0.1", "10.0.0.1", "169.254.169.254", "192.168.1.1", "100.64.12.34", "::1", "fc00::1", "ff02::1", "::ffff:127.0.0.1", "0.0.0.0", "64:ff9b::7f00:1", "2002:7f00:1::", "64:ff9b:1::1"]:
            with self.subTest(address=address):
                self.assertFalse(public_address(address))
                self.assertIsNone(self.fetch(address=address))
        self.assertEqual(self.connected, [])

    def test_mixed_public_private_dns_is_rejected_before_connection(self):
        rows = [(socket.AF_INET, socket.SOCK_STREAM, 6, "", (a, 443)) for a in ("8.8.8.8", "127.0.0.1")]
        with patch("app.tracker.browser_public_description.socket.create_connection") as connect:
            self.assertIsNone(fetch_description("https://fixture.test/", .3, resolver=lambda *a, **k: rows))
        connect.assert_not_called()

    def test_complete_head_does_not_wait_for_slow_body(self):
        start = time.monotonic()
        self.assertEqual(self.fetch("/slow-body", .2), "Public course summary")
        self.assertLess(time.monotonic()-start, .2)

    def test_deadline_and_incomplete_head_do_not_return_partial_description(self):
        self.assertIsNone(self.fetch("/slow-head", .05))
        self.assertIsNone(self.fetch("/partial"))

    def test_html_status_encoding_structure_and_size_boundaries(self):
        self.assertEqual(self.fetch("/gzip"), "Public course summary")
        for path in ["/error", "/json", "/missing", "/malformed", "/oversize", "/gzip-bomb"]:
            with self.subTest(path=path):
                self.assertIsNone(self.fetch(path))

    def test_redirects_are_same_host_bounded_and_rechecked(self):
        self.assertEqual(self.fetch("/redirect"), "Public course summary")
        self.requests.clear(); self.connected.clear()
        self.assertIsNone(self.fetch("/other-host"))
        self.assertEqual(len(self.connected), 1)
        self.requests.clear()
        self.assertIsNone(self.fetch("/loop"))
        self.assertEqual(len(self.requests), 3)

    def test_invalid_targets_and_nonfinite_budgets_never_resolve(self):
        with patch("socket.getaddrinfo") as dns:
            for url in ["http://fixture.test", "https://user:password@fixture.test", "https://fixture.test:444", "file:///tmp/page"]:
                self.assertIsNone(fetch_description(url, .3, resolver=dns))
            for budget in [0, -1, float("nan"), float("inf")]:
                self.assertIsNone(fetch_description("https://fixture.test", budget, resolver=dns))
        dns.assert_not_called()

    def test_source_cli_returns_only_bounded_json_without_tracker_state(self):
        reader = Path(__file__).parents[1]/"app/tracker/browser_public_description.py"
        root = Path(self.directory.name)/"empty"; root.mkdir(exist_ok=True)
        result = subprocess.run([sys.executable, str(reader), "http://fixture.test", "100"], cwd=root, capture_output=True, text=True, timeout=2)
        self.assertEqual(result.returncode, 0)
        self.assertIsNone(json.loads(result.stdout))
        self.assertEqual(list(root.iterdir()), [])


if __name__ == "__main__":
    unittest.main()
