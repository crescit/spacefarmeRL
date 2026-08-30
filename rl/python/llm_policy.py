"""OpenAI-compatible policy adapter for local or hosted language models."""
from __future__ import annotations

import json
import os
import re
import urllib.request
from dataclasses import dataclass
from typing import Any

import numpy as np

from rl.python.env_gym import ACTION_LABELS, FarmGymEnv


@dataclass
class ActionDecision:
    action: int
    parsed: bool
    source: str
    retry_used: bool
    finish_reason: str | None = None
    completion_tokens: int | None = None


def parse_action_candidate(text: str | None, mask: np.ndarray) -> int | None:
    """Strictly parse one valid action without inventing a model decision."""
    if not text:
        return None
    cleaned = text.strip()
    cleaned = re.sub(r"^\s*```(?:json)?\s*", "", cleaned, flags=re.I)
    cleaned = re.sub(r"\s*```\s*$", "", cleaned)
    candidates: list[Any] = []
    try:
        payload = json.loads(cleaned)
        if isinstance(payload, dict):
            candidates.extend((payload.get("action"), payload.get("action_index")))
        elif isinstance(payload, (str, int)):
            candidates.append(payload)
    except json.JSONDecodeError:
        if cleaned in ACTION_LABELS or cleaned.isdigit():
            candidates.append(cleaned)
    for candidate in candidates:
        if isinstance(candidate, str) and candidate in ACTION_LABELS:
            index = ACTION_LABELS.index(candidate)
        else:
            try:
                index = int(candidate)
            except (TypeError, ValueError):
                continue
        if 0 <= index < len(ACTION_LABELS) and bool(mask[index]):
            return index
    return None


def parse_action(text: str | None, mask: np.ndarray) -> int:
    """Compatibility helper; production policy records use of this fallback."""
    candidate = parse_action_candidate(text, mask)
    return candidate if candidate is not None else int(np.flatnonzero(mask)[0])


class OpenAIActionPolicy:
    """Choose macro actions through an OpenAI-compatible chat endpoint."""

    def __init__(
        self,
        base_url: str | None = None,
        model: str | None = None,
        api_key: str | None = None,
        timeout: float = 30.0,
        reasoning_effort: str | None = None,
        thinking: bool | None = None,
        max_output_tokens: int = 512,
        retries: int = 1,
    ):
        self.base_url = (
            base_url or os.getenv("OPENAI_BASE_URL") or "http://127.0.0.1:4000/v1"
        ).rstrip("/")
        self.model = model or os.getenv("OPENAI_MODEL") or "local-coder"
        self.api_key = api_key or os.getenv("OPENAI_API_KEY") or "sk-local"
        self.timeout = timeout
        self.reasoning_effort = (
            reasoning_effort or os.getenv("OPENAI_REASONING_EFFORT") or "low"
        )
        if thinking is None:
            thinking = os.getenv("OPENAI_THINKING", "false").lower() in {
                "1", "true", "yes", "on",
            }
        self.thinking = bool(thinking)
        self.max_output_tokens = int(max_output_tokens)
        self.retries = max(0, int(retries))
        self.last_decision: ActionDecision | None = None

    @staticmethod
    def _state(env: FarmGymEnv) -> dict[str, Any]:
        assert env.raw_obs is not None
        obs = env.raw_obs
        return {
            "credits": obs["credits"], "energy": obs["energy"], "day": obs["day"],
            "season": obs["season"], "is_day": bool(obs["isDay"]),
            "festival": bool(obs["festival"]),
            "inventory": {
                name: int(obs["inventory"][index])
                for index, name in enumerate(env.codec.items)
                if int(obs["inventory"][index]) > 0
            },
            "farm_tiles": {
                "empty": obs["farmState"].count(0),
                "tilled": obs["farmState"].count(1),
                "seeded": obs["farmState"].count(2),
                "growing": obs["farmState"].count(3),
                "mature": obs["farmState"].count(4),
                "watered": sum(int(v) for v in obs.get("farmWatered", [])),
            },
            "livestock": {
                name: {
                    "owned": int((obs.get("animals") or [0, 0, 0])[index]),
                    "fed_today": bool(
                        (obs.get("animalsFedToday") or [0, 0, 0])[index]
                    ),
                }
                for index, name in enumerate(("chicken", "cow", "sheep"))
            },
            "talked_to_rhea_today": bool(obs.get("talkedRheaToday", 0)),
        }

    def _request(self, prompt: dict[str, Any], *, thinking: bool) -> dict[str, Any]:
        body = json.dumps({
            "model": self.model,
            "messages": [
                {
                    "role": "system",
                    "content": (
                        "You control a deterministic farming simulation. "
                        "Return exactly one JSON object and no other text."
                    ),
                },
                {
                    "role": "user",
                    "content": json.dumps(prompt, separators=(",", ":")),
                },
            ],
            "temperature": 0,
            "max_tokens": self.max_output_tokens if thinking else 96,
            "chat_template_kwargs": {
                "enable_thinking": thinking,
                "thinking": thinking,
                "reasoning_effort": self.reasoning_effort,
            },
        }).encode("utf-8")
        request = urllib.request.Request(
            self.base_url + "/chat/completions",
            data=body,
            headers={
                "Authorization": "Bearer " + self.api_key,
                "Content-Type": "application/json",
            },
            method="POST",
        )
        with urllib.request.urlopen(request, timeout=self.timeout) as response:
            return json.load(response)

    def choose(self, env: FarmGymEnv) -> int:
        mask = env.action_masks()
        valid = [label for index, label in enumerate(ACTION_LABELS) if mask[index]]
        prompt = {
            "state": self._state(env),
            "valid_actions": valid,
            "objective": "maximize long-term credits without starving",
            "response_format": {"action": "one valid action name", "reason": "short"},
        }
        attempts = 1 + self.retries
        last_finish = None
        last_tokens = None
        for attempt in range(attempts):
            use_thinking = self.thinking if attempt == 0 else False
            payload = self._request(prompt, thinking=use_thinking)
            choice = payload["choices"][0]
            message = choice["message"]
            last_finish = choice.get("finish_reason")
            usage = payload.get("usage") or {}
            last_tokens = usage.get("completion_tokens")
            for source, text in (
                ("content", message.get("content")),
                ("reasoning_content", message.get("reasoning_content")),
            ):
                action = parse_action_candidate(text, mask)
                if action is not None:
                    self.last_decision = ActionDecision(
                        action=action,
                        parsed=True,
                        source=("retry_" if attempt else "primary_") + source,
                        retry_used=attempt > 0,
                        finish_reason=last_finish,
                        completion_tokens=last_tokens,
                    )
                    return action
        advance = ACTION_LABELS.index("advance_day")
        action = advance if bool(mask[advance]) else int(np.flatnonzero(mask)[0])
        self.last_decision = ActionDecision(
            action=action,
            parsed=False,
            source="fallback",
            retry_used=self.retries > 0,
            finish_reason=last_finish,
            completion_tokens=last_tokens,
        )
        return action
