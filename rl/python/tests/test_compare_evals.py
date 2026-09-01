import json
import tempfile
import unittest
from pathlib import Path

from rl.python.compare_evals import (
    load_rows,
    render_markdown,
    report_row,
    load_registry,
    check_validity,
)


def fixture(model: str = "model-a", seeds: tuple[int, ...] = (1, 2)):
    def episodes(policy: str, rewards: tuple[float, float], credits: tuple[int, int]):
        return [
            {
                "policy": policy, "seed": seed, "reward": rewards[index],
                "credits": credits[index], "steps": 10 + index,
                **({
                    "mean_latency_ms": 100 + index, "p95_latency_ms": 150,
                    "replay_ok": True, "trajectory": f"seed-{seed}.jsonl",
                } if policy == model else {}),
            }
            for index, seed in enumerate(seeds)
        ]
    return {
        "schema_version": 1,
        "environment": {
            "action_interface": "masked-macro-v1",
            "horizon_days": 12,
            "seeds": list(seeds),
        },
        "model": {"name": model, "base_url": "http://localhost/v1"},
        "episodes": {
            "model": episodes(model, (1.0, 3.0), (100, 300)),
            "random": episodes("random", (-2.0, -2.0), (20, 20)),
            "economic": episodes("economic", (5.0, 5.0), (500, 500)),
        },
    }


class CompareEvalTests(unittest.TestCase):
    def test_row_metrics_and_markdown(self):
        row = report_row(fixture(), Path("model-a.json"))
        self.assertEqual(row["reward"], 2.0)
        self.assertEqual(row["credits"], 200.0)
        self.assertEqual(row["vs_random"], 4.0)
        self.assertEqual(row["oracle_gap"], 3.0)
        self.assertTrue(row["replay_ok"])
        report = fixture()
        report["episodes"]["model"][0]["mean_latency_ms"] = None
        partial_latency = report_row(report, Path("model-a.json"))
        self.assertEqual(partial_latency["latency_ms"], 101.0)
        markdown = render_markdown([partial_latency])
        self.assertIn("| model-a |", markdown)
        self.assertIn("2.000 ± 1.000", markdown)

    def test_rejects_incompatible_protocols(self):
        with tempfile.TemporaryDirectory() as directory:
            first = Path(directory) / "a.json"
            second = Path(directory) / "b.json"
            first.write_text(json.dumps(fixture("a")), encoding="utf-8")
            second.write_text(json.dumps(fixture("b", (3, 4))), encoding="utf-8")
            with self.assertRaisesRegex(ValueError, "not directly comparable"):
                load_rows([first, second])

    def test_refuses_invalid_reports_by_default(self):
        registry = {"a.json": {"validity": "invalid", "note": "diagnostic only"}}
        rows = [report_row(fixture("a"), Path("a.json"))]
        with self.assertRaisesRegex(ValueError, "protocol lock"):
            check_validity(rows, registry, allow_invalid=False)

    def test_allow_invalid_flags_and_excludes_from_table(self):
        registry = {"a.json": {"validity": "invalid", "note": "diagnostic only"}}
        rows = [report_row(fixture("a"), Path("a.json"))]
        valid, invalid = check_validity(rows, registry, allow_invalid=True)
        self.assertEqual(valid, [])
        self.assertEqual(len(invalid), 1)
        markdown = render_markdown(valid, invalid, registry)
        self.assertIn("Invalid / archived reports", markdown)
        self.assertIn("diagnostic only", markdown)
        # invalid reports must not appear in the comparable table
        self.assertNotIn("| model-a |", markdown)

    def test_empty_leaderboard_is_honest(self):
        markdown = render_markdown([], [], {})
        self.assertIn("No valid reports on the locked protocol", markdown)

    def test_load_rows_skips_models_json(self):
        with tempfile.TemporaryDirectory() as directory:
            report = Path(directory) / "model-a.json"
            report.write_text(json.dumps(fixture("a")), encoding="utf-8")
            meta = Path(directory) / "models.json"
            meta.write_text(json.dumps({"runs": {}}), encoding="utf-8")
            rows = load_rows([report, meta])
            self.assertEqual(len(rows), 1)
            self.assertEqual(rows[0]["model"], "a")


if __name__ == "__main__":
    unittest.main()
