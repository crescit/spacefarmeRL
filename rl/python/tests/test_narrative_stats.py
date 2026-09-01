"""RL W5 — narrative ledger, episode-summary records, report v4, parallel eval."""
import argparse
import json
import tempfile
import unittest
from pathlib import Path

import numpy as np

from rl.python.env_gym import FarmGymEnv
from rl.python.eval_local_model import (
    ModelEpisode, build_result, evaluate_episode, evaluate_seeds,
)
from rl.python.llm_policy import ActionDecision
from rl.python.rollout_tools import parse_horizon
from rl.python.trajectory import TrajectoryRecorder, replay_trajectory


class StubPolicy:
    """Deterministic no-network policy: always the first valid macro action."""

    model = "stub"

    def __init__(self):
        self.last_decision = None

    def choose(self, env: FarmGymEnv) -> int:
        mask = env.action_masks()
        action = int(np.flatnonzero(mask)[0])
        self.last_decision = ActionDecision(
            action=action, parsed=True, source="stub", retry_used=False
        )
        return action


class NarrativeStatsTests(unittest.TestCase):
    def test_stats_and_testimony_through_bridge(self):
        env = FarmGymEnv(horizon_days=5)
        try:
            env.reset(seed=1)
            env.step(6)   # mine
            env.step(1)   # plant
            env.step(2)   # water
            env.write_journal("first light")
            stats = env.narrative_stats()
            self.assertIn("daysSurvived", stats)
            self.assertEqual(stats["journalEntries"], 1)
            self.assertGreaterEqual(stats["mineSwingOk"], 1)
            self.assertIn("mine", stats["tools"])
            testimony = env.testimony()
            self.assertIn("What kind of keeper were you?", testimony)
            # Reward-neutral: testimony is prose, never a signal.
            env2 = FarmGymEnv(horizon_days=5)
            try:
                env2.reset(seed=1)
                env2.step(6)
                env2.step(1)
                env2.step(2)
                env2.write_journal("first light")
                self.assertEqual(env.testimony(), env2.testimony())
            finally:
                env2.close()
        finally:
            env.close()

    def test_trajectory_appends_summary_replay_skips_it(self):
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / "episode.jsonl"
            recorder = TrajectoryRecorder(FarmGymEnv(horizon_days=5), path)
            actions = [6, 6, 5, 0, 6, 13]
            try:
                recorder.reset(seed=55)
                for action in actions:
                    recorder.step(action)
            finally:
                recorder.close()
            lines = [json.loads(line) for line in path.read_text().splitlines() if line]
            self.assertEqual(lines[-1]["kind"], "episode-summary")
            self.assertIn("testimony", lines[-1])
            self.assertIn("tools", lines[-1]["stats"])
            result = replay_trajectory(path)
            self.assertEqual(result["steps"], len(actions))
            self.assertEqual(result["seed"], 55)

    def test_report_v4_fields_and_summary(self):
        episode = ModelEpisode(
            policy="stub", seed=1, reward=3.5, steps=40, credits=120.0,
            mean_latency_ms=2.0, p95_latency_ms=4.0, trajectory="t.jsonl",
            replay_ok=True, days=29, quests=2, friendships=12.0,
            friends_made=3, journal_entries=4, festivals=1, unique_tools=5,
            testimony="Spring on B-612 is over.",
        )
        result = build_result(
            type("P", (), {
                "model": "stub", "base_url": "x", "reasoning_effort": "low",
                "thinking": False, "max_output_tokens": 512, "retries": 0,
            })(),
            [1], 30, {"model": [episode.__dict__]}, complete=True,
        )
        self.assertEqual(result["report_version"], 4)
        summary = result["summary"]["model"]
        self.assertEqual(summary["mean_days"], 29)
        self.assertEqual(summary["mean_quests"], 2)
        self.assertEqual(summary["mean_festivals"], 1)
        self.assertEqual(summary["mean_unique_tools"], 5)

    def test_evaluate_episode_captures_narrative(self):
        with tempfile.TemporaryDirectory() as directory:
            traj_dir = Path(directory) / "t"
            episode = evaluate_episode(
                StubPolicy(), 1, 5, 100, traj_dir, resume=False
            )
            self.assertIsInstance(episode.testimony, str)
            self.assertTrue(episode.testimony)
            self.assertGreaterEqual(episode.days, 0)
            self.assertTrue(episode.replay_ok)

    def test_parallel_workers_equivalent_to_serial(self):
        def run(workers):
            with tempfile.TemporaryDirectory() as directory:
                args = argparse.Namespace(
                    workers=workers, horizon_days=5, max_steps=100,
                    output=Path(directory) / "report.json",
                    resume=False,
                    base_url=None, model=None, api_key=None, timeout=1.0,
                    reasoning_effort="low", thinking=False,
                    max_output_tokens=64, policy_retries=0,
                )
                episodes = evaluate_seeds(
                    args, [1, 2, 3], Path(directory) / "traj", set(),
                    policy_factory=StubPolicy,
                )
                return {
                    e.seed: (e.reward, e.steps, e.credits, e.days)
                    for e in episodes
                }
        serial = run(1)
        parallel = run(3)
        self.assertEqual(serial, parallel)

    def test_horizon_parsing_uses_single_source_calendar(self):
        self.assertEqual(parse_horizon("1 season"), 30)
        self.assertEqual(parse_horizon("1 year"), 120)
        self.assertEqual(parse_horizon("12"), 12)


if __name__ == "__main__":
    unittest.main()
