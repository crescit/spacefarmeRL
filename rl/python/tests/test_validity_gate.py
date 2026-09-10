"""W4 validity gates — regression tests that would have caught the masked-macro
v2 collapse.

Per the roadmap, the evaluator must fail loudly (never silently cap or pass)
when parse / fallback rates exceed a floor, and every episode must report
primary_valid_rate / retry_rate / fallback_count. These tests pin three
properties:

1. A stub model producing VARIED valid actions must produce a trajectory
   DISTINCT from the masked-macro fallback trajectory (the v2 collapse was
   everything silently flattening onto the fallback), and record a clean
   primary-parse telemetry record.
2. Truncated model output and request timeouts must SURFACE as validity
   telemetry / exceptions — never as a silently healthy-looking episode.
3. The parse-rate gate must produce a valid report XOR a loud refusal: garbage
   runs are refused, healthy runs pass.
"""
import json
import tempfile
import unittest
from pathlib import Path
from types import SimpleNamespace
from unittest.mock import patch

import numpy as np

from rl.python.env_gym import ACTION_LABELS
from rl.python.eval_local_model import (
    ModelEpisode, evaluate_episode, validate_runtime_quality,
)
from rl.python.llm_policy import OpenAIActionPolicy


def _decision(parsed: bool) -> SimpleNamespace:
    return SimpleNamespace(
        parsed=parsed, retry_used=False, source="primary_content"
    )


class VariedValidStub:
    """A stub model that always parses on the primary attempt and cycles through
    every mask-valid action deterministically. This is the anti-collapse
    control: if the pipeline flattens varied valid actions back onto the
    fallback trajectory (the v2 failure), this test fails."""
    model = "stub-varied-valid"

    def __init__(self) -> None:
        self.last_decision = None
        self._step = 0

    def choose(self, env):
        mask = env.action_masks()
        valid = [index for index in range(len(ACTION_LABELS)) if mask[index]]
        action = valid[self._step % len(valid)]
        self._step += 1
        self.last_decision = _decision(parsed=True)
        return action


class FallbackStub:
    """A model that never parses and always takes the first mask-valid action —
    exactly the masked-macro fallback trajectory."""
    model = "stub-fallback"

    def __init__(self) -> None:
        self.last_decision = None

    def choose(self, env):
        self.last_decision = _decision(parsed=False)
        return int(np.flatnonzero(env.action_masks())[0])


def _actions(path: Path) -> list[int]:
    """The per-step macro action ints recorded in a masked-macro trajectory."""
    out: list[int] = []
    for line in path.read_text(encoding="utf-8").splitlines():
        if not line:
            continue
        record = json.loads(line)
        if isinstance(record.get("action"), int):
            out.append(record["action"])
    return out


class ValidityGateTests(unittest.TestCase):
    def test_varied_valid_actions_diverge_from_fallback(self):
        """Regression: a working model's trajectory must NOT equal the fallback
        trajectory, and its telemetry must show 100% clean primary parses."""
        with tempfile.TemporaryDirectory() as directory:
            directory = Path(directory)
            varied_dir = directory / "varied"
            fall_dir = directory / "fallback"
            varied = evaluate_episode(VariedValidStub(), 1, 12, 400, varied_dir)
            fallback = evaluate_episode(FallbackStub(), 1, 12, 400, fall_dir)
            self.assertTrue(varied.replay_ok)
            self.assertTrue(fallback.replay_ok)
            self.assertFalse(varied.capped)
            # clean quality telemetry on the working stub
            self.assertEqual(varied.primary_valid_rate, 1.0)
            self.assertEqual(varied.retry_rate, 0.0)
            self.assertEqual(varied.fallback_count, 0)
            # the whole point of the regression: varied valid actions are NOT
            # the fallback trajectory (would have caught the v2 collapse)
            varied_actions = _actions(varied_dir / "seed-1.jsonl")
            fallback_actions = _actions(fall_dir / "seed-1.jsonl")
            self.assertNotEqual(varied_actions, fallback_actions)
            self.assertTrue(len(varied_actions) > 2)
            self.assertGreater(len(set(varied_actions)), 1)

    def test_truncated_output_surfaces_and_is_refused(self):
        """Truncated model output (no parseable action) must surface as
        fallback telemetry and trip the gate — never pass silently."""
        policy = OpenAIActionPolicy(thinking=True, retries=1)
        empty = {
            "choices": [
                {
                    "finish_reason": "length",
                    "message": {"content": None, "reasoning_content": None},
                }
            ],
            "usage": {"completion_tokens": 512},
        }
        with tempfile.TemporaryDirectory() as directory:
            directory = Path(directory)
            with patch.object(policy, "_request", return_value=empty):
                episode = evaluate_episode(policy, 3, 4, 60, directory)
            self.assertFalse(episode.capped)
            self.assertEqual(
                episode.incomplete_reason, "unparseable_model_output"
            )
            self.assertGreater(episode.fallback_count, 0)
            self.assertLess(episode.primary_valid_rate, 0.5)
            records = [
                json.loads(line)
                for line in (directory / "seed-3.jsonl").read_text().splitlines()
                if line
            ]
            failure = next(
                row for row in records if row.get("kind") == "policy-failure"
            )
            self.assertEqual(failure["step"], 0)
            self.assertIn("raw_outputs", failure["policy_decision"])
            self.assertEqual(
                failure["policy_decision"]["finish_reason"], "length"
            )
            # a truncated run must be refused loudly, not recorded as evidence
            with self.assertRaisesRegex(ValueError, "incomplete"):
                validate_runtime_quality([episode])

    def test_timeout_propagates_loudly(self):
        """A request timeout must surface as an exception — never swallowed into
        a healthy-looking capped or fallback episode."""
        import urllib.error

        policy = OpenAIActionPolicy(timeout=0.001)
        with tempfile.TemporaryDirectory() as directory:
            directory = Path(directory)
            with patch.object(
                policy, "_request", side_effect=urllib.error.URLError("timeout")
            ):
                with self.assertRaises(urllib.error.URLError):
                    evaluate_episode(policy, 1, 4, 100, directory)

    def test_healthy_run_passes_gate(self):
        episodes = [
            ModelEpisode(
                policy="m", seed=seed, reward=1.0, steps=40, credits=100,
                mean_latency_ms=None, p95_latency_ms=None, trajectory="seed-1.jsonl",
                replay_ok=True, primary_valid_rate=1.0,
                retry_rate=0.0, fallback_count=0,
            )
            for seed in (1, 2)
        ]
        validate_runtime_quality(episodes)  # must not raise

    def test_gate_refuses_low_primary_parse(self):
        episode = ModelEpisode(
            policy="m", seed=1, reward=0.0, steps=30, credits=0,
            mean_latency_ms=None, p95_latency_ms=None, trajectory="seed-1.jsonl",
            replay_ok=True, primary_valid_rate=0.3, retry_rate=0.7, fallback_count=0,
        )
        with self.assertRaisesRegex(ValueError, "primary_valid_rate"):
            validate_runtime_quality([episode])

    def test_gate_refuses_high_fallback(self):
        # every step fell back (fallback ratio = 1.0 > 0.1 ceiling)
        episode = ModelEpisode(
            policy="m", seed=1, reward=0.0, steps=30, credits=0,
            mean_latency_ms=None, p95_latency_ms=None, trajectory="seed-1.jsonl",
            replay_ok=True, primary_valid_rate=0.0, retry_rate=0.0, fallback_count=30,
        )
        with self.assertRaisesRegex(ValueError, "fallback"):
            validate_runtime_quality([episode])

    def test_gate_refuses_silent_cap(self):
        episode = ModelEpisode(
            policy="m", seed=1, reward=0.0, steps=500, credits=0,
            mean_latency_ms=None, p95_latency_ms=None, trajectory="seed-1.jsonl",
            replay_ok=True, capped=True, primary_valid_rate=1.0,
            retry_rate=0.0, fallback_count=0,
        )
        with self.assertRaisesRegex(ValueError, "max_steps"):
            validate_runtime_quality([episode])

    def test_gate_exempts_recovered_episodes(self):
        # resume-recovered runs carry no decision telemetry; they were already
        # replay-validated on adoption and must not be re-refused
        episode = ModelEpisode(
            policy="m", seed=1, reward=0.0, steps=30, credits=0,
            mean_latency_ms=None, p95_latency_ms=None, trajectory="seed-1.jsonl",
            replay_ok=True, capped=True,
        )
        validate_runtime_quality([episode])  # must not raise


if __name__ == "__main__":
    unittest.main()
