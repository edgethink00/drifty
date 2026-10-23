from __future__ import annotations

import io
import json
import os
import sys
import unittest
from pathlib import Path
from unittest.mock import patch

SERVICE_ROOT = Path(__file__).resolve().parents[1]
if str(SERVICE_ROOT) not in sys.path:
    sys.path.insert(0, str(SERVICE_ROOT))

from app.cli.main import run_cli
from app.cli.mcp import TOOLS, handle_message, serve, tool_arguments
import tests.test_cli as cli_fixture


def request(method: str, params: dict | None = None, message_id: int = 1) -> dict:
    message: dict = {"jsonrpc": "2.0", "id": message_id, "method": method}
    if params is not None:
        message["params"] = params
    return message


class DriftyMcpTests(unittest.TestCase):
    # Reuse the CLI fixture database without re-running the CLI tests themselves.
    setUp = cli_fixture.DriftyCliTests.setUp
    tearDown = cli_fixture.DriftyCliTests.tearDown

    def call(self, name: str, arguments: dict, detail: str = "safe") -> dict:
        with patch.dict(os.environ, {"TZ": "Asia/Seoul"}):
            response = handle_message(request("tools/call", {"name": name, "arguments": arguments}), self.db_path, detail)
        assert response is not None
        return response["result"]

    def test_initialize_advertises_tools_and_ignores_notifications(self) -> None:
        response = handle_message(request("initialize", {"protocolVersion": "2025-06-18"}), self.db_path, "safe")
        assert response is not None
        self.assertEqual(response["result"]["protocolVersion"], "2025-06-18")
        self.assertIn("tools", response["result"]["capabilities"])
        self.assertEqual(response["result"]["serverInfo"]["name"], "drifty")
        self.assertIsNone(handle_message({"jsonrpc": "2.0", "method": "notifications/initialized"}, self.db_path, "safe"))

    def test_unknown_protocol_version_falls_back_to_the_latest_supported(self) -> None:
        response = handle_message(request("initialize", {"protocolVersion": "1999-01-01"}), self.db_path, "safe")
        assert response is not None
        self.assertEqual(response["result"]["protocolVersion"], "2025-06-18")

    def test_every_tool_is_read_only(self) -> None:
        response = handle_message(request("tools/list"), self.db_path, "safe")
        assert response is not None
        tools = response["result"]["tools"]
        self.assertEqual([tool["name"] for tool in tools], ["summary", "search", "timeline"])
        for tool in tools:
            self.assertTrue(tool["annotations"]["readOnlyHint"])
            self.assertFalse(tool["annotations"]["destructiveHint"])
            self.assertFalse(tool["inputSchema"]["additionalProperties"])

    def test_summary_returns_the_cli_envelope_without_private_detail(self) -> None:
        before = self.db_path.read_bytes()
        result = self.call("summary", {"day": "2026-07-29"})
        self.assertFalse(result["isError"])
        envelope = result["structuredContent"]
        self.assertTrue(envelope["ok"])
        self.assertEqual(envelope["data"]["focusSeconds"], 8100)
        self.assertEqual(json.loads(result["content"][0]["text"]), envelope)
        self.assertNotIn("SENTINEL", result["content"][0]["text"])
        self.assertEqual(self.db_path.read_bytes(), before)

    def test_the_server_detail_policy_decides_titles_not_the_agent(self) -> None:
        safe = self.call("search", {"query": "Polaris", "day": "2026-07-29"})
        self.assertNotIn("SENTINEL_WINDOW", safe["content"][0]["text"])
        self.assertEqual(safe["structuredContent"]["query"]["detail"], "safe")
        rejected = self.call("search", {"query": "Polaris", "day": "2026-07-29", "detail": "full"})
        self.assertTrue(rejected["isError"])
        full = self.call("timeline", {"day": "2026-07-29"}, detail="full")
        self.assertIn("SENTINEL_WINDOW", full["content"][0]["text"])
        self.assertNotIn("SENTINEL_RAW", full["content"][0]["text"])
        titles = self.call("timeline", {"day": "2026-07-29"}, detail="titles")
        self.assertIn("SENTINEL_WINDOW", titles["content"][0]["text"])
        self.assertNotIn("SENTINEL_URL", titles["content"][0]["text"])
        self.assertEqual(titles["structuredContent"]["query"]["detail"], "titles")

    def test_invalid_calls_are_tool_errors(self) -> None:
        for name, arguments in (
            ("summary", {}),
            ("summary", {"day": 20260729}),
            ("search", {"query": "x", "day": "2026-07-29", "from": "2026-07-28T00:00:00+09:00"}),
            ("search", {"query": "x", "from": "2026-07-28T00:00:00+09:00"}),
            ("timeline", {"day": "2026-07-29", "limit": 0}),
            ("timeline", {"day": "2026-07-29", "limit": True}),
            ("write_note", {}),
        ):
            with self.subTest(name=name, arguments=arguments):
                self.assertTrue(self.call(name, arguments)["isError"])
        bad_day = self.call("summary", {"day": "yesterday"})
        self.assertTrue(bad_day["isError"])
        self.assertEqual(bad_day["structuredContent"]["error"]["code"], "invalid_arguments")

    def test_search_accepts_trimmed_fraction_bounds_through_the_tool(self) -> None:
        before = self.db_path.read_bytes()
        result = self.call("search", {
            "query": "Safari", "from": "2026-07-29T10:59:59.65494+09:00",
            "to": "2026-07-29T11:45:00.5+09:00",
        })
        self.assertFalse(result["isError"], result)
        envelope = result["structuredContent"]
        self.assertEqual(envelope["data"]["resultCount"], 1)
        self.assertEqual(envelope["data"]["matchedSeconds"], 2700)
        self.assertEqual(json.loads(result["content"][0]["text"]), envelope)
        self.assertNotIn("SENTINEL", result["content"][0]["text"])
        self.assertEqual(self.db_path.read_bytes(), before)

    def test_tool_arguments_map_to_cli_arguments(self) -> None:
        self.assertEqual(
            tool_arguments("search", {"query": "Polaris", "from": "a", "to": "b", "limit": 5}, "safe"),
            ["search", "--query", "Polaris", "--from", "a", "--to", "b", "--limit", "5", "--detail", "safe"],
        )
        self.assertEqual(tool_arguments("summary", {"day": "2026-07-29"}, "full"), ["summary", "--day", "2026-07-29"])
        self.assertEqual(len(TOOLS), 3)

    def test_unknown_methods_and_malformed_input_return_json_rpc_errors(self) -> None:
        unknown = handle_message(request("resources/list"), self.db_path, "safe")
        assert unknown is not None
        self.assertEqual(unknown["error"]["code"], -32601)
        invalid = handle_message({"id": 3, "method": "ping"}, self.db_path, "safe")
        assert invalid is not None
        self.assertEqual(invalid["error"]["code"], -32600)
        output = io.StringIO()
        serve(self.db_path, "safe", io.StringIO("not json\n\n"), output)
        self.assertEqual(json.loads(output.getvalue())["error"]["code"], -32700)

    def test_cli_mcp_command_serves_stdio_until_input_closes(self) -> None:
        lines = [
            request("initialize", {"protocolVersion": "2025-06-18"}, 1),
            {"jsonrpc": "2.0", "method": "notifications/initialized"},
            request("tools/call", {"name": "summary", "arguments": {"day": "2026-07-29"}}, 2),
        ]
        stdin = io.StringIO("".join(json.dumps(line) + "\n" for line in lines))
        stdout = io.StringIO()
        with patch.dict(os.environ, {"TZ": "Asia/Seoul"}), patch.object(sys, "stdin", stdin), patch.object(sys, "stdout", stdout):
            exit_code = run_cli(["--db", str(self.db_path), "mcp"])
        self.assertEqual(exit_code, 0)
        responses = [json.loads(line) for line in stdout.getvalue().splitlines()]
        self.assertEqual([response["id"] for response in responses], [1, 2])
        self.assertTrue(responses[1]["result"]["structuredContent"]["ok"])


if __name__ == "__main__":
    unittest.main()

