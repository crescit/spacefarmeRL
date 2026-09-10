import io
import json
import tempfile
import unittest
from unittest.mock import patch
from pathlib import Path
from types import SimpleNamespace

import numpy as np

from rl.python.env_gym import ACTION_LABELS, FarmGymEnv
from rl.python.eval_local_model import (
    ACTION_INTERFACE, ModelEpisode, action_interface, aggregate, build_result,
    evaluate_episode, load_completed, percentile, recover_capped_episode,
    write_result,
)
from rl.python.llm_policy import (
    OpenAIActionPolicy, extract_native_action_attempt, parse_action, parse_action_batch, parse_action_candidate,
    native_action_validation_error, parse_native_action_candidate, parse_rationale,
)


class LlmPolicyTests(unittest.TestCase):
    def test_collects_streamed_reasoning_content_and_usage(self):
        response = io.BytesIO(b"".join([
            b'data: {"choices":[{"delta":{"reasoning_content":"plan "}}]}\n\n',
            b'data: {"choices":[{"delta":{"content":"{\\"action\\":"}}]}\n\n',
            b'data: {"choices":[{"delta":{"content":"\\"advance\\"}"},"finish_reason":"stop"}]}\n\n',
            b'data: {"choices":[],"usage":{"completion_tokens":17}}\n\n',
            b'data: [DONE]\n\n',
        ]))
        payload = OpenAIActionPolicy._read_stream(response, started_at=0.0)
        self.assertEqual(
            payload["choices"][0]["message"]["content"],
            '{"action":"advance"}',
        )
        self.assertEqual(
            payload["choices"][0]["message"]["reasoning_content"], "plan "
        )
        self.assertEqual(payload["choices"][0]["finish_reason"], "stop")
        self.assertEqual(payload["usage"]["completion_tokens"], 17)
        self.assertIsNotNone(payload["_timing"]["ttft_ms"])

    def test_stream_reader_accepts_nonstreaming_gateway_response(self):
        response = io.BytesIO(json.dumps({
            "choices": [{"message": {"content": "ok"}}]
        }).encode())
        payload = OpenAIActionPolicy._read_stream(response)
        self.assertEqual(payload["choices"][0]["message"]["content"], "ok")

    def test_policy_reasoning_controls(self):
        policy = OpenAIActionPolicy(
            reasoning_effort="high", thinking=True
        )
        self.assertEqual(policy.reasoning_effort, "high")
        self.assertTrue(policy.thinking)

    def test_action_descriptions_come_from_environment_schema(self):
        policy = OpenAIActionPolicy()
        env = FarmGymEnv(horizon_days=3)
        try:
            env.reset(seed=1)
            descriptions = policy._action_descriptions(env)
            rest = next(
                tool for tool in env.bridge.spec["tools"]
                if tool.get("nativeAction") == "advance"
            )
            self.assertEqual(descriptions["advance"], rest["description"])
            self.assertEqual(set(descriptions), set(ACTION_LABELS))
        finally:
            env.close()

    def test_policy_prompt_exposes_resolved_payload_and_long_horizon_mechanics(self):
        policy = OpenAIActionPolicy(retries=0)
        response = {"choices": [{"finish_reason": "stop", "message": {
            "content": '{"action":"equip","arguments":{"tool":"hoe"}}',
            "reasoning_content": None,
        }}]}
        env = FarmGymEnv(horizon_days=30)
        try:
            env.reset(seed=1)
            captured = {}

            def request(prompt, *, thinking):
                captured.update(prompt)
                return response

            with patch.object(policy, "_request", side_effect=request):
                action = policy.choose(env)
            self.assertEqual(action, ACTION_LABELS.index("equip"))
            equip = next(row for row in captured["valid_actions"] if row["name"] == "equip")
            self.assertEqual(equip["example_native_action"], {"type": "equip", "tool": "hoe"})
            self.assertEqual(equip["current_cost"]["energy"], 0)
            self.assertEqual(equip["current_cost"]["clock_units"], 22)
            self.assertFalse(equip["current_cost"]["advances_day"])
            self.assertEqual(policy.last_decision.native_action, {"type": "equip", "tool": "hoe"})
            planning = captured["episode_contract"]["mechanics"]["planningFacts"]
            self.assertEqual(planning["cropLoop"]["maturityWateredDays"], 6)
            self.assertEqual(planning["time"]["staminaRecoveredOnAdvance"], 30)
            self.assertEqual(planning["time"]["staminaCapacityGrowthAfterWorkedDay"], 2)
            self.assertEqual(planning["time"]["staminaCapacityMaximum"], 150)
            self.assertIn("downstream return", captured["planning_rule"])
            self.assertEqual(captured["state"]["equipped"], "bare hands")
            self.assertEqual(captured["state"]["inventory"]["seeds"], 5)
            self.assertEqual(captured["state"]["season"]["name"], "spring")
            self.assertEqual(captured["state"]["active_farm_tiles"], [])
            self.assertEqual(len(captured["state"]["available_empty_tiles"]), 8)
            self.assertNotIn("action_values", captured["response_format"])
            talk = next(row for row in captured["valid_actions"] if row["name"] == "talk")
            self.assertIn("quasar", talk["current_argument_constraints"]["eligible_npcs_today"])
            self.assertEqual(next(iter(captured)), "state")
        finally:
            env.close()

    def test_native_action_parser_preserves_model_strategy_arguments(self):
        env = FarmGymEnv(horizon_days=30)
        try:
            env.reset(seed=1)
            native = parse_native_action_candidate(
                '{"action":"buy","arguments":{"item":"seeds","quantity":7}}',
                env,
            )
            self.assertEqual(native, {"type": "buy", "item": "seeds", "quantity": 7})
            env.native_step(native)
            self.assertEqual(env.raw_obs["inventory"]["seeds"], 12)
            self.assertEqual(env.raw_obs["credits"], 65)
            self.assertIsNone(parse_native_action_candidate(
                '{"action":"buy","arguments":{"item":"imaginary","quantity":1}}',
                env,
            ))
        finally:
            env.close()

    def test_unchecked_attempt_preserves_illegal_model_payload_without_repair(self):
        self.assertEqual(
            extract_native_action_attempt(
                '{"action":"plant","arguments":{"crop":"space-wheat","tile":{"x":0,"y":0},"quantity":4}}'
            ),
            {"type": "plant", "crop": "space-wheat", "tile": {"x": 0, "y": 0}, "quantity": 4},
        )

    def test_native_action_rejection_explains_invalid_prerequisite_and_shape(self):
        env = FarmGymEnv(horizon_days=30)
        try:
            env.reset(seed=1)
            invalid_now = native_action_validation_error(
                '{"action":"plant","arguments":{"tileX":0,"tileY":0,"crop":"space-wheat"}}',
                env,
            )
            self.assertIn("not currently valid", invalid_now)
            env.native_step({"type": "equip", "tool": "hoe"})
            env.native_step({"type": "till", "tileX": 0, "tileY": 0})
            invalid_shape = native_action_validation_error(
                '{"action":"plant","arguments":{"crop":"space-wheat","tile":{"x":0,"y":0},"quantity":4}}',
                env,
            )
            self.assertIn("do not exactly match", invalid_shape)
            self.assertIn("tileX", invalid_shape)
        finally:
            env.close()

    def test_native_action_parser_rejects_parameter_level_illegal_talk(self):
        env = FarmGymEnv(horizon_days=30)
        try:
            env.reset(seed=1)
            talk = '{"action":"talk","arguments":{"npc":"quasar"}}'
            self.assertEqual(
                parse_native_action_candidate(talk, env),
                {"type": "talk", "npc": "quasar"},
            )
            env.native_step({"type": "talk", "npc": "quasar"})
            self.assertIsNone(parse_native_action_candidate(talk, env))
            self.assertIn("already-talked", native_action_validation_error(talk, env))
        finally:
            env.close()

    def test_prompt_removes_already_talked_npc_from_current_schema(self):
        env = FarmGymEnv(horizon_days=3)
        policy = OpenAIActionPolicy(retries=0)
        response = {"choices": [{"finish_reason": "stop", "message": {
            "content": '{"action":"equip","arguments":{"tool":"hoe"}}',
            "reasoning_content": None,
        }}]}
        captured = {}
        try:
            env.reset(seed=1)
            env.native_step({"type": "talk", "npc": "quasar"})

            def request(prompt, *, thinking):
                captured.update(prompt)
                return response

            with patch.object(policy, "_request", side_effect=request):
                policy.choose(env)
            talk_spec = next(row for row in captured["valid_actions"] if row["name"] == "talk")
            self.assertNotIn("quasar", talk_spec["parameters"]["properties"]["npc"]["enum"])
            self.assertEqual(captured["state"]["quest"]["current"], "q1_first_soil")
        finally:
            env.close()

    def test_policy_retry_receives_validation_feedback(self):
        policy = OpenAIActionPolicy(retries=1)
        responses = iter([
            {"choices": [{"finish_reason": "stop", "message": {
                "content": '{"action":"plant","arguments":{"crop":"space-wheat","x":0,"y":0}}',
                "reasoning_content": None,
            }}]},
            {"choices": [{"finish_reason": "stop", "message": {
                "content": '{"action":"equip","arguments":{"tool":"hoe"}}',
                "reasoning_content": None,
            }}]},
        ])
        prompts = []

        def request(prompt, *, thinking):
            prompts.append(prompt)
            return next(responses)

        env = FarmGymEnv(horizon_days=30)
        try:
            env.reset(seed=1)
            with patch.object(policy, "_request", side_effect=request):
                action = policy.choose(env)
            self.assertEqual(action, ACTION_LABELS.index("equip"))
            self.assertNotIn("retry_correction", prompts[0])
            self.assertIn("not currently valid", prompts[1]["retry_correction"])
            self.assertTrue(prompts[1]["valid_examples_now"])
            self.assertEqual(next(iter(prompts[1])), "retry_correction")
        finally:
            env.close()

    def test_request_adds_native_task_to_user_message(self):
        policy = OpenAIActionPolicy(model_task="action", stream=False)
        response = io.BytesIO(json.dumps({
            "choices": [{"message": {"content": '{"action":"advance"}'}}]
        }).encode())
        with patch("urllib.request.urlopen", return_value=response) as urlopen:
            policy._request({"state": {}}, thinking=True)
        request = urlopen.call_args.args[0]
        body = json.loads(request.data)
        self.assertEqual(body["messages"][-1]["task"], "action")

    def test_strict_candidate_rejects_prose(self):
        mask = np.ones(len(ACTION_LABELS), dtype=np.int8)
        self.assertIsNone(parse_action_candidate("I might till or fish", mask))

    def test_strict_batch_parser(self):
        self.assertEqual(
            parse_action_batch('{"actions":["till","plant","water"]}', 2),
            [ACTION_LABELS.index("till"), ACTION_LABELS.index("plant")],
        )
        self.assertIsNone(parse_action_batch('{"actions":["till","bogus"]}', 8))
        self.assertEqual(
            parse_rationale('{"reason":"sell raises credits","action":"sell"}'),
            "sell raises credits",
        )

    def test_batched_policy_reuses_valid_queued_actions_without_model_call(self):
        policy = OpenAIActionPolicy(action_batch_size=3, retries=0)
        response = {"choices": [{"finish_reason": "stop", "message": {
            "content": '{"actions":[{"type":"advance"},{"type":"advance"},{"type":"advance"}]}',
            "reasoning_content": None,
        }}]}
        env = FarmGymEnv(horizon_days=12)
        try:
            env.reset(seed=1)
            with patch.object(policy, "_request", return_value=response) as request:
                first = policy.choose(env)
                env.step(first)
                second = policy.choose(env)
            self.assertEqual(first, ACTION_LABELS.index("advance"))
            self.assertEqual(second, ACTION_LABELS.index("advance"))
            self.assertEqual(request.call_count, 1)
            self.assertFalse(policy.last_decision.model_called)
            self.assertEqual(policy.last_decision.source, "queued_batch")
        finally:
            env.close()

    def test_batched_policy_replans_when_queued_action_is_invalid(self):
        policy = OpenAIActionPolicy(action_batch_size=2, retries=0)
        responses = [
            {"choices": [{"finish_reason": "stop", "message": {
                "content": '{"actions":[{"type":"advance"},{"type":"claimFestival"}]}',
                "reasoning_content": None,
            }}]},
            {"choices": [{"finish_reason": "stop", "message": {
                "content": '{"actions":[{"type":"advance"}]}',
                "reasoning_content": None,
            }}]},
        ]
        env = FarmGymEnv(horizon_days=12)
        try:
            env.reset(seed=1)
            with patch.object(policy, "_request", side_effect=responses) as request:
                first = policy.choose(env)
                env.step(first)
                second = policy.choose(env)
            self.assertEqual(second, ACTION_LABELS.index("advance"))
            self.assertEqual(request.call_count, 2)
            self.assertTrue(policy.last_decision.model_called)
        finally:
            env.close()

    def test_batched_policy_uses_distinct_action_interface(self):
        policy = OpenAIActionPolicy(action_batch_size=8)
        self.assertEqual(
            action_interface(policy), ACTION_INTERFACE + "-batch-8"
        )

    def test_native_task_uses_distinct_action_interface(self):
        policy = OpenAIActionPolicy(action_batch_size=8, model_task="action")
        self.assertEqual(
            action_interface(policy),
            ACTION_INTERFACE + "-batch-8-action-task",
        )

    def test_policy_retries_null_reasoning_then_parses_json(self):
        policy = OpenAIActionPolicy(thinking=True, retries=1)
        responses = [
            {"choices": [{"finish_reason": "length", "message": {"content": None, "reasoning_content": None}}], "usage": {"completion_tokens": 512}},
            {"choices": [{"finish_reason": "stop", "message": {"content": "{\"action\":\"advance\",\"arguments\":{}}", "reasoning_content": None}}], "usage": {"completion_tokens": 12}},
        ]
        env = FarmGymEnv(horizon_days=12)
        try:
            env.reset(seed=1)
            with patch.object(policy, "_request", side_effect=responses):
                action = policy.choose(env)
            self.assertEqual(action, ACTION_LABELS.index("advance"))
            self.assertTrue(policy.last_decision.parsed)
            self.assertEqual(policy.last_decision.source, "retry_content")
        finally:
            env.close()

    def test_policy_retry_keeps_uniform_reasoning_treatment(self):
        policy = OpenAIActionPolicy(thinking=True, retries=1)
        responses = iter([
            {"choices": [{"finish_reason": "length", "message": {
                "content": None, "reasoning_content": None,
            }}]},
            {"choices": [{"finish_reason": "stop", "message": {
                "content": '{"action":"advance","arguments":{}}',
                "reasoning_content": None,
            }}]},
        ])
        thinking_values = []

        def request(_prompt, *, thinking):
            thinking_values.append(thinking)
            return next(responses)

        env = FarmGymEnv(horizon_days=12)
        try:
            env.reset(seed=1)
            with patch.object(policy, "_request", side_effect=request):
                policy.choose(env)
            self.assertEqual(thinking_values, [True, True])
        finally:
            env.close()

    def test_policy_records_fallback_after_failed_retry(self):
        policy = OpenAIActionPolicy(thinking=True, retries=1)
        empty = {"choices": [{"finish_reason": "length", "message": {"content": None, "reasoning_content": None}}], "usage": {"completion_tokens": 512}}
        env = FarmGymEnv(horizon_days=12)
        try:
            env.reset(seed=1)
            with patch.object(policy, "_request", side_effect=[empty, empty]):
                action = policy.choose(env)
            self.assertEqual(action, -1)
            self.assertFalse(policy.last_decision.parsed)
            self.assertEqual(policy.last_decision.source, "fallback")
            self.assertIsNone(policy.last_decision.native_action)
        finally:
            env.close()

    def test_policy_records_and_executes_recognizable_invalid_attempt(self):
        policy = OpenAIActionPolicy(retries=0)
        response = {"choices": [{"finish_reason": "stop", "message": {
            "content": '{"action":"plant","arguments":{"crop":"space-wheat","x":0,"y":0}}',
            "reasoning_content": None,
        }}]}
        env = FarmGymEnv(horizon_days=12)
        try:
            env.reset(seed=1)
            with patch.object(policy, "_request", return_value=response):
                action = policy.choose(env)
            self.assertEqual(action, ACTION_LABELS.index("plant"))
            self.assertEqual(policy.last_decision.source, "invalid_payload")
            self.assertEqual(
                policy.last_decision.native_action,
                {"type": "plant", "crop": "space-wheat", "x": 0, "y": 0},
            )
            self.assertIn("not currently valid", policy.last_decision.raw_outputs[0]["validation_error"])
        finally:
            env.close()

    def test_json_action(self):
        mask = np.ones(len(ACTION_LABELS), dtype=np.int8)
        self.assertEqual(parse_action('{"action":"mine"}', mask), ACTION_LABELS.index("mine"))

    def test_invalid_action_falls_back_to_valid(self):
        mask = np.zeros(len(ACTION_LABELS), dtype=np.int8)
        mask[ACTION_LABELS.index("advance")] = 1
        self.assertEqual(parse_action('{"action":"mine"}', mask), -1)

    def test_null_content_falls_back_to_valid(self):
        mask = np.zeros(len(ACTION_LABELS), dtype=np.int8)
        mask[ACTION_LABELS.index("advance")] = 1
        self.assertEqual(parse_action(None, mask), -1)

    def test_numeric_action(self):
        mask = np.ones(len(ACTION_LABELS), dtype=np.int8)
        self.assertEqual(parse_action('{"action_index":5}', mask), 5)

    def test_resume_loads_compatible_completed_seeds(self):
        policy = SimpleNamespace(
            model="test-model", base_url="http://localhost/v1",
            reasoning_effort="low", thinking=False,
            max_output_tokens=512, retries=1,
        )
        episode = ModelEpisode(
            policy="test-model", seed=1, reward=2.0, steps=4, credits=120,
            mean_latency_ms=10, p95_latency_ms=15,
            trajectory="seed-1.jsonl", replay_ok=True,
        )
        result = build_result(
            policy, [1, 2], 12, {"model": [episode.__dict__]}, complete=False
        )
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / "partial.json"
            write_result(path, result)
            loaded = load_completed(path, policy, [1, 2], 12)
            self.assertEqual([item.seed for item in loaded], [1])
            saved = json.loads(path.read_text(encoding="utf-8"))
            self.assertFalse(saved["complete"])
            self.assertEqual(saved["environment"]["action_interface"], ACTION_INTERFACE)

    def test_max_steps_caps_and_recovers_episode(self):
        policy = SimpleNamespace(
            model="test-model", base_url="http://localhost/v1",
            choose=lambda env: ACTION_LABELS.index("advance"),
        )
        with tempfile.TemporaryDirectory() as directory:
            trajectory_dir = Path(directory)
            episode = evaluate_episode(policy, 1, 12, 2, trajectory_dir)
            self.assertTrue(episode.capped)
            self.assertEqual(episode.steps, 2)
            recovered = recover_capped_episode(policy, 1, 12, 2, trajectory_dir)
            self.assertIsNotNone(recovered)
            self.assertTrue(recovered.capped)
            self.assertEqual(recovered.reward, episode.reward)
            self.assertIsNone(recovered.mean_latency_ms)
            continued = evaluate_episode(
                policy, 1, 12, 3, trajectory_dir, resume=True
            )
            self.assertEqual(continued.steps, 3)
            self.assertTrue(continued.capped)
            self.assertIsNone(continued.mean_latency_ms)
            self.assertEqual(continued.model_calls, 0)

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
