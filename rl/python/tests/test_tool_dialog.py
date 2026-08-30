"""ToolDialogPolicy round-trip against a scripted local OpenAI-compatible stub."""
from __future__ import annotations

import json
import threading
import unittest
from http.server import BaseHTTPRequestHandler, HTTPServer

from rl.python.env_gym import FarmGymEnv
from rl.python.llm_policy import ToolDialogPolicy, native_from_tool


def call(name: str, args: dict) -> dict:
    return {
        "id": f"call_{name}",
        "type": "function",
        "function": {"name": name, "arguments": json.dumps(args)},
    }


def response(*calls, content=None, finish="stop") -> dict:
    message: dict[str, object] = {"role": "assistant"}
    if calls:
        message["tool_calls"] = [
            {"id": c["id"], "type": "function", "function": c["function"]} for c in calls
        ]
    if content:
        message["content"] = content
    return {"choices": [{"message": message, "finish_reason": finish}]}


class _StubHandler(BaseHTTPRequestHandler):
    queue: list[dict] = []
    cycle: list[dict] = []
    received: list[dict] = []
    _cycle_i = 0

    def do_POST(self):
        length = int(self.headers.get("Content-Length", 0))
        body = json.loads(self.rfile.read(length))
        self.__class__.received.append(body)
        if self.__class__.queue:
            payload = self.__class__.queue.pop(0)
        elif self.__class__.cycle:
            payload = self.__class__.cycle[self.__class__._cycle_i % len(self.__class__.cycle)]
            self.__class__._cycle_i += 1
        else:
            payload = response(content="Done.")
        data = json.dumps(payload).encode("utf-8")
        self.send_response(200)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(data)))
        self.end_headers()
        self.wfile.write(data)

    def log_message(self, *_args):  # silence
        pass


class StubServer:
    def __init__(self):
        self.httpd = HTTPServer(("127.0.0.1", 0), _StubHandler)
        self.port = self.httpd.server_address[1]
        self.thread = threading.Thread(target=self.httpd.serve_forever, daemon=True)

    def __enter__(self):
        self.thread.start()
        _StubHandler.queue = []
        _StubHandler.received = []
        return self

    def __exit__(self, *_exc):
        self.httpd.shutdown()
        self.httpd.server_close()


class ToolDialogTests(unittest.TestCase):
    def test_native_from_tool_mapping(self):
        self.assertEqual(native_from_tool("rest", {}), {"type": "advance_day"})
        self.assertEqual(
            native_from_tool("plant", {"x": 3, "y": 2, "crop": "star-berry"}),
            {"type": "plant", "tileX": 3, "tileY": 2, "crop": "star-berry"},
        )
        self.assertEqual(
            native_from_tool("gift", {"npc": "rhea", "item": "cooked-food", "quantity": 1}),
            {"type": "gift", "npc": "rhea", "item": "cooked-food", "quantity": 1},
        )
        self.assertEqual(native_from_tool("mine", {}), {"type": "mine"})

    def test_dialog_round_trip(self):
        with StubServer() as srv:
            # Scripted keeper: till → plant+water (parallel) → journal → rest → goodnight.
            _StubHandler.queue = [
                response(call("till", {"x": 0, "y": 0})),
                response(call("plant", {"x": 0, "y": 0, "crop": "space-wheat"}), call("water", {"x": 0, "y": 0})),
                response(call("write_journal", {"entry": "Day one. The ridge bell stayed silent."})),
                response(call("rest", {})),
                response(content="Goodnight, colony."),
            ]
            env = FarmGymEnv(horizon_days=28)
            env.reset(seed=4, options={"narrative": True, "horizon_days": 28})
            policy = ToolDialogPolicy(
                base_url=f"http://127.0.0.1:{srv.port}/v1",
                model="stub", api_key="sk-local", tools=[],
            )
            policy.begin_day(env.briefing())

            # 1. till
            native = policy.choose_native(env)
            self.assertEqual(native, {"type": "till", "tileX": 0, "tileY": 0})
            _, _r, _t, _tr, info = env.native_step(native)
            self.assertTrue(info.get("ok"))
            policy.observe(native, info)

            # 2. plant (first of a parallel pair)
            native = policy.choose_native(env)
            self.assertEqual(native["type"], "plant")
            _, _r, _t, _tr, info = env.native_step(native)
            policy.observe(native, info)

            # 3. water comes from the pending second call — no new model request
            before = len(_StubHandler.received)
            native = policy.choose_native(env)
            self.assertEqual(native, {"type": "water", "tileX": 0, "tileY": 0})
            self.assertEqual(len(_StubHandler.received), before)

            # 4. journal is answered in-loop (no env step); then rest() ends the day
            native = policy.choose_native(env)
            self.assertEqual(native, {"type": "advance_day"})
            _, _r, _t, _tr, info = env.native_step(native)
            policy.observe(native, info)

            # 5. model says goodnight — a text-only turn → the keeper has spoken
            self.assertIsNone(policy.choose_native(env))
            self.assertEqual(policy.text_only_turns, 1)

    def test_stub_season_rollout_replays(self):
        """A stub agent plays a few spring days through the dialog → trajectory
        v2 with native actions + prose → exact replay, and the actions diverge
        from the deterministic first-valid fallback (the v2-collapse trap)."""
        import tempfile
        from pathlib import Path
        from rl.python.trajectory import TrajectoryRecorder, replay_trajectory

        with StubServer() as srv:
            _StubHandler.cycle = [
                response(call("till", {"x": 0, "y": 0})),
                response(call("plant", {"x": 0, "y": 0, "crop": "space-wheat"})),
                response(call("water", {"x": 0, "y": 0})),
                response(call("talk", {"npc": "quasar"})),
                response(call("rest", {})),
            ]
            tmp = Path(tempfile.mkdtemp()) / "spring.jsonl"
            env = FarmGymEnv(horizon_days=12)
            rec = TrajectoryRecorder(env, tmp, action_interface="native-tools-v1")
            rec.reset(seed=7, options={"narrative": True, "horizon_days": 12})
            policy = ToolDialogPolicy(
                base_url=f"http://127.0.0.1:{srv.port}/v1",
                model="stub", api_key="sk-local", tools=[],
            )
            policy.begin_day(env.briefing())
            actions = []
            for _ in range(30):
                native = policy.choose_native(env)
                from_model = native is not None
                if native is None:
                    native = {"type": "advance_day"}   # keeper declined → the day ends
                _, _, term, trunc, info = rec.step_native(native, tool=native["type"])
                if from_model:
                    policy.observe(native, info)
                actions.append(native["type"])
                if native["type"] == "advance_day":
                    policy.begin_day(env.briefing())   # a fresh morning, same keeper
                if term or trunc:
                    break
            rec.close()

            records = [json.loads(l) for l in tmp.read_text().splitlines()]
            self.assertEqual(records[0]["action_interface"], "native-tools-v1")
            self.assertTrue(records[1].get("prose"))
            rep = replay_trajectory(tmp)
            self.assertEqual(rep["steps"], len(actions))
            # The stub's varied life must NOT collapse to the first-valid fallback.
            self.assertGreater(len(set(actions)), 1, f"stub collapsed: {actions}")

    def test_model_tools_passthrough(self):
        with StubServer() as srv:
            env = FarmGymEnv(horizon_days=28)
            env.reset(seed=4)
            policy = ToolDialogPolicy(
                base_url=f"http://127.0.0.1:{srv.port}/v1",
                model="stub", api_key="sk-local",
                tools=[{"name": "till", "parameters": {"type": "object"}}],
            )
            policy.begin_day("It is morning.")
            policy.choose_native(env)
            body = _StubHandler.received[-1]
            self.assertIn("tools", body)
            self.assertEqual(body["tool_choice"], "auto")
            self.assertEqual(body["tools"][0]["name"], "till")


if __name__ == "__main__":
    unittest.main()
