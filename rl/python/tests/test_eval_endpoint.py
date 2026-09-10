import argparse
import unittest

from rl.python.eval_endpoint import (
    RELEASE_REASONING_EFFORT, RELEASE_TRAJECTORY_PROFILE, build_command,
    choose_model, evaluation_profile, model_slug, normalize_base_url,
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

    def test_locked_command_uses_portable_fast_action_profile(self):
        args = argparse.Namespace(
            seeds=30, seed_start=1, horizon="1 season", workers=1,
            max_steps=500, timeout=120.0, max_output_tokens=256,
            policy_retries=1, reasoning_effort="low", action_batch_size=1,
            model_task="none",
            output=None, trajectory_dir=None,
        )
        command = build_command(args, "http://spark:8000/v1", "deepseek-mia")
        self.assertEqual(
            command[command.index("--reasoning-effort") + 1],
            RELEASE_REASONING_EFFORT,
        )
        self.assertEqual(RELEASE_REASONING_EFFORT, "low")
        self.assertIn("--no-thinking", command)
        self.assertNotIn("--model-task", command)
        self.assertIn("--stream", command)
        self.assertEqual(command[command.index("--seeds") + 1], "30")
        self.assertEqual(command[command.index("--max-output-tokens") + 1], "256")
        self.assertEqual(command[command.index("--action-batch-size") + 1], "1")
        self.assertEqual(command[command.index("--workers") + 1], "1")
        self.assertEqual(
            command[command.index("--output") + 1],
            f"reports/evals/deepseek-mia-{RELEASE_TRAJECTORY_PROFILE}.json",
        )
        self.assertEqual(
            command[command.index("--trajectory-dir") + 1],
            f"trajectories/deepseek-mia/{RELEASE_TRAJECTORY_PROFILE}",
        )

    def test_batched_high_trial_gets_isolated_artifacts(self):
        args = argparse.Namespace(
            seeds=1, seed_start=1, horizon="1 season", workers=1,
            max_steps=80, timeout=120.0, max_output_tokens=4096,
            policy_retries=1, reasoning_effort="high", action_batch_size=8,
            model_task="none",
            output=None, trajectory_dir=None,
        )
        profile = evaluation_profile("high", 8)
        command = build_command(args, "http://spark:8000/v1", "deepseek-vision")
        self.assertEqual(profile, "energy-grounded-native-batch-8-high-stream")
        self.assertEqual(
            command[command.index("--output") + 1],
            f"reports/evals/deepseek-vision-{profile}.json",
        )
        self.assertEqual(
            command[command.index("--trajectory-dir") + 1],
            f"trajectories/deepseek-vision/{profile}",
        )


if __name__ == "__main__":
    unittest.main()
