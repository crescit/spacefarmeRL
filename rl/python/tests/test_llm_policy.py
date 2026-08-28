import unittest

import numpy as np

from rl.python.env_gym import ACTION_LABELS
from rl.python.eval_local_model import aggregate, percentile
from rl.python.llm_policy import parse_action


class LlmPolicyTests(unittest.TestCase):
    def test_json_action(self):
        mask = np.ones(len(ACTION_LABELS), dtype=np.int8)
        self.assertEqual(parse_action('{"action":"mine"}', mask), ACTION_LABELS.index("mine"))

    def test_invalid_action_falls_back_to_valid(self):
        mask = np.zeros(len(ACTION_LABELS), dtype=np.int8)
        mask[ACTION_LABELS.index("advance_day")] = 1
        self.assertEqual(parse_action('{"action":"mine"}', mask), ACTION_LABELS.index("advance_day"))

    def test_null_content_falls_back_to_valid(self):
        mask = np.zeros(len(ACTION_LABELS), dtype=np.int8)
        mask[ACTION_LABELS.index("advance_day")] = 1
        self.assertEqual(parse_action(None, mask), ACTION_LABELS.index("advance_day"))

    def test_numeric_action(self):
        mask = np.ones(len(ACTION_LABELS), dtype=np.int8)
        self.assertEqual(parse_action('{"action_index":5}', mask), 5)

    def test_eval_summary_and_percentile(self):
        rows = [
            {"reward": 1.0, "credits": 100, "steps": 4,
             "mean_latency_ms": 10, "p95_latency_ms": 14},
            {"reward": 3.0, "credits": 300, "steps": 8,
             "mean_latency_ms": 20, "p95_latency_ms": 26},
        ]
        summary = aggregate(rows)
        self.assertEqual(summary["mean_reward"], 2.0)
        self.assertEqual(summary["mean_credits"], 200.0)
        self.assertEqual(summary["mean_steps"], 6.0)
        self.assertEqual(summary["mean_latency_ms"], 15.0)
        self.assertEqual(percentile([1, 9, 4, 7], 0.95), 9.0)


if __name__ == "__main__":
    unittest.main()
