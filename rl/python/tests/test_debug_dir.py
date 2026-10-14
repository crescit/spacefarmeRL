"""--debug-dir capture: every raw model call lands in calls.jsonl (no auth)."""
from __future__ import annotations

import io
import json
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

from rl.python.env_gym import ACTION_LABELS, FarmGymEnv
from rl.python.llm_policy import OpenAIActionPolicy, ToolDialogPolicy
from rl.python.tests.test_tool_dialog import call, response


def canned_body() -> dict:
    return {
        "choices": [{
            "finish_reason": "stop",
            "message": {"content": '{"action":"advance"}', "reasoning_content": None},
        }],
        "usage": {"completion_tokens": 8, "prompt_tokens": 21},
    }


def canned_tool_call() -> dict:
    return response(call("till", {"x": 0, "y": 0}))


def fake_urlopen(queue: list[dict]):
    """Monkeypatched HTTP function: pop the canned payload, return bytes."""
    def handler(request, timeout=None):
        return io.BytesIO(json.dumps(queue.pop(0)).encode("utf-8"))
    return handler


class DebugDirTests(unittest.TestCase):
    def test_action_policy_records_calls_jsonl_and_never_writes_auth(self):
        debug_dir = Path(tempfile.mkdtemp()) / "dbg"
        queue = [canned_body(), canned_body()]
        policy = OpenAIActionPolicy(
            api_key="sk-secret-000", stream=False, retries=0,
            debug_dir=str(debug_dir),
        )
        env = FarmGymEnv(horizon_days=3)
        try:
            env.reset(seed=1)
            with patch(
                "rl.python.llm_policy.urllib.request.urlopen",
                side_effect=fake_urlopen(queue),
            ):
                first = policy.choose(env)
                second = policy.choose(env)
            self.assertEqual(first, ACTION_LABELS.index("advance"))
            self.assertEqual(second, ACTION_LABELS.index("advance"))
        finally:
            env.close()
        path = debug_dir / "calls.jsonl"
        self.assertTrue(path.exists())
        lines = path.read_text().splitlines()
        self.assertEqual(len(lines), 2)
        text = path.read_text()
        self.assertNotIn("Authorization", text)
        self.assertNotIn("Bearer", text)
        self.assertNotIn("sk-secret", text)
        for index, line in enumerate(lines):
            record = json.loads(line)
            self.assertEqual(record["i"], index + 1)
            self.assertGreaterEqual(record["ts"], 0)
            self.assertEqual(
                record["request"]["messages"][0]["role"], "system",
            )
            self.assertIn("messages", record["request"])
            self.assertEqual(record["response"]["choices"][0]["finish_reason"], "stop")
            self.assertGreaterEqual(record["latency_ms"], 0)
            self.assertEqual(record["finish_reason"], "stop")
            self.assertEqual(record["usage"]["completion_tokens"], 8)
            self.assertLess(record["i"], 3)

    def test_tool_dialog_records_calls_jsonl_with_tool_call_response(self):
        debug_dir = Path(tempfile.mkdtemp()) / "dbg"
        queue = [canned_tool_call(), canned_tool_call()]
        policy = ToolDialogPolicy(
            api_key="Bearer-tainted-token", tools=[], debug_dir=str(debug_dir),
        )
        env = FarmGymEnv(horizon_days=3)
        try:
            env.reset(seed=1)
            with patch(
                "rl.python.llm_policy.urllib.request.urlopen",
                side_effect=fake_urlopen(queue),
            ):
                policy.begin_day("Day 3 briefing.")
                native_first = policy.choose_native(env)
                policy.observe(native_first, {"prose": "Tilled."})
                policy.begin_day("Day 4 briefing.")
                native_second = policy.choose_native(env)
            self.assertEqual(native_first["type"], "till")
            self.assertEqual(native_second["type"], "till")
        finally:
            env.close()
        path = debug_dir / "calls.jsonl"
        self.assertTrue(path.exists())
        text = path.read_text()
        self.assertNotIn("Bearer", text)
        lines = text.splitlines()
        self.assertEqual(len(lines), 2)
        for line in lines:
            record = json.loads(line)
            self.assertEqual(record["request"]["messages"][0]["role"], "system")
            self.assertEqual(
                record["response"]["choices"][0]["message"]["tool_calls"][0][
                    "function"
                ]["name"], "till",
            )
            self.assertGreaterEqual(record["latency_ms"], 0)
            self.assertEqual(record["finish_reason"], "stop")

    def test_no_debug_dir_writes_nothing(self):
        clean = Path(tempfile.mkdtemp())
        before = sorted(item.name for item in clean.iterdir())
        policy = OpenAIActionPolicy(api_key="sk-local", debug_dir=None)
        self.assertIsNone(policy.debug_dir)
        self.assertEqual(sorted(item.name for item in clean.iterdir()), before)
        self.assertFalse(clean.joinpath("calls.jsonl").exists())


if __name__ == "__main__":
    unittest.main()
