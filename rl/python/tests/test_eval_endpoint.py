import argparse
import unittest

from rl.python.eval_endpoint import (
    build_command, choose_model, model_slug, normalize_base_url,
)


class EndpointEvalTests(unittest.TestCase):
    def test_normalizes_server_root_and_v1(self):
        self.assertEqual(normalize_base_url("spark:8000"), "http://spark:8000/v1")
        self.assertEqual(normalize_base_url("https://spark/v1/"), "https://spark/v1")

    def test_requires_unambiguous_model_discovery(self):
        self.assertEqual(choose_model(["deepseek-mia"]), "deepseek-mia")
        with self.assertRaises(ValueError):
            choose_model(["a", "b"])

    def test_slug_is_filesystem_safe(self):
        self.assertEqual(model_slug("org/model name"), "org-model-name")

    def test_locked_command_uses_max_effort_and_serial_requests(self):
        args = argparse.Namespace(
            seeds=30, seed_start=1, horizon="1 season", workers=1,
            max_steps=500, timeout=120.0, max_output_tokens=4096,
            policy_retries=1, output=None, trajectory_dir=None,
        )
        command = build_command(args, "http://spark:8000/v1", "deepseek-mia")
        self.assertIn("max", command)
        self.assertEqual(command[command.index("--workers") + 1], "1")
        self.assertEqual(command[command.index("--output") + 1], "reports/evals/deepseek-mia.json")


if __name__ == "__main__":
    unittest.main()
