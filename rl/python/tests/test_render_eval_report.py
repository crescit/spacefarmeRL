import json
import tempfile
import unittest
from pathlib import Path

from rl.python.render_eval_report import load_reports, render


class RenderEvalReportTests(unittest.TestCase):
    def test_repeated_current_and_archive_cards(self):
        fixture = {
            "complete": True,
            "environment": {
                "action_interface": "masked-macro-v2",
                "horizon_days": 12,
                "seeds": [1],
            },
            "model": {
                "name": "model-a",
                "thinking": True,
                "reasoning_effort": "low",
            },
            "episodes": {
                "model": [{
                    "seed": 1,
                    "reward": 2,
                    "credits": 150,
                    "steps": 8,
                    "mean_latency_ms": 10,
                    "replay_ok": True,
                    "trajectory": "trajectory.jsonl",
                }]
            },
        }
        registry = {
            "models": {
                "model-a": {
                    "display_name": "Model A",
                    "quantization": "NVFP4",
                }
            }
        }
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            (root / "archive").mkdir()
            (root / "a.json").write_text(json.dumps(fixture), encoding="utf-8")
            (root / "archive" / "old.json").write_text(
                json.dumps(fixture), encoding="utf-8"
            )
            output = render(load_reports(root), registry)
        self.assertEqual(output.count('<article class="card'), 2)
        self.assertIn("Model A", output)
        self.assertIn("NVFP4", output)
        self.assertIn("trajectory.jsonl", output)
        self.assertIn("archived", output)


if __name__ == "__main__":
    unittest.main()
