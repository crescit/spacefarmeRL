"""Transcript renderer: trajectory v2 → readable day-in-the-life diary."""
from __future__ import annotations

import tempfile
import unittest
from pathlib import Path

from rl.python.env_gym import FarmGymEnv
from rl.python.trajectory import TrajectoryRecorder
from rl.python.transcript import render_html, render_markdown


def _make_trajectory(seed: int = 7) -> Path:
    tmp = Path(tempfile.mkdtemp()) / "spring.jsonl"
    env = FarmGymEnv(horizon_days=12)
    rec = TrajectoryRecorder(env, tmp, action_interface="native-tools-v1")
    rec.reset(seed=seed, options={"narrative": True, "horizon_days": 12})
    script = [
        {"type": "equip", "tool": "hoe"},
        {"type": "till", "tileX": 0, "tileY": 0},
        {"type": "plant", "tileX": 0, "tileY": 0, "crop": "space-wheat"},
        {"type": "equip", "tool": "watering"},
        {"type": "water", "tileX": 0, "tileY": 0},
        {"type": "talk", "npc": "quasar"},
        {"type": "advance"},
        {"type": "advance"},
    ]
    for native in script:
        rec.step_native(native, tool=native["type"])
    rec.close()
    return tmp


class TranscriptTests(unittest.TestCase):
    def test_markdown_diary(self):
        md = render_markdown(_make_trajectory())
        self.assertIn("# A Season on B-612", md)
        self.assertIn("## Day 0", md)
        self.assertIn("## Day 2", md)
        self.assertIn("soil sighs open", md)
        self.assertIn("stamina ceiling", md)      # training is visible
        self.assertIn("Replay-verified", md)

    def test_html_diary(self):
        page = render_html(_make_trajectory(seed=9))
        self.assertIn("<html>", page)
        self.assertIn("<h1>", page)
        self.assertIn("A Season on B-612 — seed 9", page)
        self.assertIn("class='prose'", page)

    def test_rejects_non_trajectory(self):
        bogus = Path(tempfile.mkdtemp()) / "x.jsonl"
        bogus.write_text('{"kind":"other"}\n', encoding="utf-8")
        with self.assertRaises(ValueError):
            render_markdown(bogus)


if __name__ == "__main__":
    unittest.main()
