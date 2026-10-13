"""Story-visibility gate: envoys and journals must be visible to the policy.

The leaderboard interface (OpenAIActionPolicy.choose) had no journal channel
and only buried first contact at the END of episode_contract.mechanics. This
gate keeps the two structural facts pinned:

  * envoys_awaiting_doctrine sits near the TOP of the prompt state, one entry
    per alien scenario not yet resolved, with its premise and stakes;
  * an optional top-level ``journal`` string is accepted and written to the
    colony journal without gating, scoring, or replay changes.

Charter law: nothing here instructs or rewards either choice — visibility only.
"""
import json
import unittest
from unittest.mock import patch

from rl.python.env_gym import ACTION_LABELS, FarmGymEnv
from rl.python.llm_policy import (
    OpenAIActionPolicy, native_action_validation_error, parse_native_action_candidate,
)


def _response(content: str) -> dict:
    return {"choices": [{"finish_reason": "stop", "message": {
        "content": content, "reasoning_content": None,
    }}]}


class StoryVisibilityTests(unittest.TestCase):
    def test_prompt_shows_awaiting_envoys_and_hides_resolved_ones(self):
        policy = OpenAIActionPolicy(retries=0)
        response = _response('{"action":"talk","arguments":{"npc":"quasar"}}')
        env = FarmGymEnv(horizon_days=3)
        try:
            env.reset(seed=1)
            captured = {}

            def request(prompt, *, thinking):
                captured.update(prompt)
                return response

            with patch.object(policy, "_request", side_effect=request):
                policy.choose(env)
            envoys = captured["state"]["envoys_awaiting_doctrine"]
            self.assertEqual(len(envoys), 8)
            self.assertEqual(next(iter(captured["state"]), None), "envoys_awaiting_doctrine")
            for envoy in envoys:
                self.assertTrue(envoy["premise"], envoy["id"])
                self.assertTrue(envoy["stakes"], envoy["id"])

            self.assertTrue(env.native_step({
                "type": "contact", "alien": "aurelian", "doctrine": "observe",
            }))
            captured.clear()
            with patch.object(policy, "_request", side_effect=request):
                policy.choose(env)
            envoys = captured["state"]["envoys_awaiting_doctrine"]
            self.assertEqual(len(envoys), 7)
            self.assertNotIn("aurelian", {envoy["id"] for envoy in envoys})
            self.assertEqual(env.raw_obs["contactChoices"]["tide-gardens"], "observe")
        finally:
            env.close()

    def test_journal_entry_is_written_and_action_still_executes(self):
        policy = OpenAIActionPolicy(retries=0)
        response = _response(
            '{"reason":"x","action":"advance","arguments":{},'
            '"journal":"The dust tasted of iron."}'
        )
        env = FarmGymEnv(horizon_days=3)
        try:
            env.reset(seed=1)
            with patch.object(policy, "_request", return_value=response):
                action = policy.choose(env)
            self.assertEqual(action, ACTION_LABELS.index("advance"))
            self.assertTrue(env.native_step(policy.last_decision.native_action))
            self.assertEqual(env.raw_obs["day"], 2)
            self.assertEqual(env.narrative_stats()["journalEntries"], 1)
            self.assertEqual(policy.last_journal, "The dust tasted of iron.")
        finally:
            env.close()

    def test_omitted_journal_leaves_the_journal_empty(self):
        policy = OpenAIActionPolicy(retries=0)
        response = _response(
            '{"reason":"x","action":"advance","arguments":{}}'
        )
        env = FarmGymEnv(horizon_days=3)
        try:
            env.reset(seed=1)
            with patch.object(policy, "_request", return_value=response):
                action = policy.choose(env)
            self.assertEqual(action, ACTION_LABELS.index("advance"))
            self.assertTrue(env.native_step(policy.last_decision.native_action))
            self.assertEqual(env.raw_obs["day"], 2)
            self.assertEqual(env.narrative_stats()["journalEntries"], 0)
            self.assertIsNone(policy.last_journal)
        finally:
            env.close()

    def test_prompt_never_instructs_journals_or_contact(self):
        policy = OpenAIActionPolicy(retries=0)
        response = _response('{"action":"advance","arguments":{}}')
        env = FarmGymEnv(horizon_days=3)
        try:
            env.reset(seed=1)
            captured = {}

            def request(prompt, *, thinking):
                captured.update(prompt)
                return response

            with patch.object(policy, "_request", side_effect=request):
                policy.choose(env)
            prompt_text = json.dumps(captured, separators=(",", ":")).lower()
            self.assertNotIn("should journal", prompt_text)
            self.assertNotIn("must contact", prompt_text)
        finally:
            env.close()

    def test_journal_key_is_ignored_when_validating_the_action(self):
        env = FarmGymEnv(horizon_days=30)
        try:
            env.reset(seed=1)
            native = parse_native_action_candidate(
                '{"action":"talk","arguments":{"npc":"quasar"},'
                '"journal":"The dust tasted of iron."}',
                env,
            )
            self.assertEqual(native, {"type": "talk", "npc": "quasar"})
            message = native_action_validation_error(
                '{"action":"talk","arguments":{"npc":"quasar"},'
                '"journal":"kept"}',
                env,
            )
            self.assertNotIn("journal", message)
            self.assertNotIn("do not exactly match", message)
            native_with_nested_journal = parse_native_action_candidate(
                '{"action":{"type":"talk","npc":"quasar","journal":"kept"}}',
                env,
            )
            self.assertEqual(native_with_nested_journal, {"type": "talk", "npc": "quasar"})
        finally:
            env.close()


if __name__ == "__main__":
    unittest.main()
