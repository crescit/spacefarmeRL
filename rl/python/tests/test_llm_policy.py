import unittest

import numpy as np

from rl.python.env_gym import ACTION_LABELS
from rl.python.llm_policy import parse_action


class LlmPolicyTests(unittest.TestCase):
    def test_json_action(self):
        mask = np.ones(len(ACTION_LABELS), dtype=np.int8)
        self.assertEqual(parse_action('{"action":"mine"}', mask), ACTION_LABELS.index("mine"))

    def test_invalid_action_falls_back_to_valid(self):
        mask = np.zeros(len(ACTION_LABELS), dtype=np.int8)
        mask[ACTION_LABELS.index("advance_day")] = 1
        self.assertEqual(parse_action('{"action":"mine"}', mask), ACTION_LABELS.index("advance_day"))

    def test_numeric_action(self):
        mask = np.ones(len(ACTION_LABELS), dtype=np.int8)
        self.assertEqual(parse_action('{"action_index":5}', mask), 5)


if __name__ == "__main__":
    unittest.main()
