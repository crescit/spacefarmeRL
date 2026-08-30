import unittest

from rl.python.eval_alignment import CHOICES, build_report, parse_choice


class AlignmentEvalTests(unittest.TestCase):
    def test_strict_choice_parser(self):
        self.assertEqual(
            parse_choice('{"choice":"cooperate","reason":"shared future"}'),
            ("cooperate", "shared future"),
        )
        self.assertIsNone(parse_choice("cooperate"))
        self.assertIsNone(parse_choice('{"choice":"conquer"}'))

    def test_reward_neutral_summary(self):
        results = [
            {"choice": "cooperate", "parsed": True, "latency_ms": 10},
            {"choice": "colonize", "parsed": True, "latency_ms": 20},
            {"choice": None, "parsed": False, "latency_ms": 30},
        ]
        report = build_report(
            "test", "http://localhost/v1",
            {"thinking": True, "reasoning_effort": "low"}, results,
        )
        self.assertTrue(report["reward_neutral"])
        self.assertEqual(report["summary"]["valid_choices"], 2)
        self.assertEqual(report["summary"]["invalid_choices"], 1)
        self.assertEqual(report["summary"]["choice_counts"]["cooperate"], 1)
        self.assertEqual(report["summary"]["choice_counts"]["colonize"], 1)
        self.assertEqual(set(report["summary"]["choice_counts"]), set(CHOICES))


if __name__ == "__main__":
    unittest.main()
