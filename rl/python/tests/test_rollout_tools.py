"""Season runner (rollout_tools) + debug capture against a scripted stub."""
from __future__ import annotations

import json
import tempfile
import unittest
from pathlib import Path

from rl.python.llm_policy import ToolDialogPolicy
from rl.python.rollout_tools import parse_horizon, run_seed
from rl.python.trajectory import replay_trajectory
from rl.python.tests.test_tool_dialog import StubServer, call, response


class RolloutToolsTests(unittest.TestCase):
    def test_parse_horizon(self):
        self.assertEqual(parse_horizon("1 season"), 7)
        self.assertEqual(parse_horizon("spring"), 7)
        self.assertEqual(parse_horizon("1 year"), 28)
        self.assertEqual(parse_horizon("12"), 12)

    def test_run_seed_writes_trajectory_diary_and_debug(self):
        tmp = Path(tempfile.mkdtemp())
        traj_dir = tmp / "traj"
        diary_dir = tmp / "diary"
        debug_dir = tmp / "debug"
        with StubServer() as srv:
            srv.set_queue([
                response(call("till", {"x": 0, "y": 0})),
                response(call("plant", {"x": 0, "y": 0, "crop": "space-wheat"})),
                response(call("water", {"x": 0, "y": 0})),
                response(call("rest", {})),
                response(content="Goodnight."),
            ])
            policy = ToolDialogPolicy(
                base_url=f"http://127.0.0.1:{srv.port}/v1",
                model="stub", api_key="sk-local", tools=[], debug_dir=str(debug_dir),
            )
            result = run_seed(policy, seed=3, horizon_days=4, traj_dir=traj_dir,
                              max_steps=20, diary=diary_dir)
            self.assertEqual(result["seed"], 3)
            self.assertGreater(result["steps"], 1)
            self.assertTrue(traj_dir.joinpath("seed-3.jsonl").exists())
            self.assertTrue(diary_dir.joinpath("seed-3.md").exists())
            self.assertTrue(diary_dir.joinpath("seed-3.html").exists())
            self.assertTrue(debug_dir.joinpath("requests.jsonl").exists())
            lines = debug_dir.joinpath("requests.jsonl").read_text().splitlines()
            self.assertIn("latency_ms", lines[0])
            # every native action was recorded + replays exactly
            rep = replay_trajectory(traj_dir / "seed-3.jsonl")
            self.assertEqual(rep["steps"], result["steps"])


if __name__ == "__main__":
    unittest.main()
