"""OpenAI-compatible policy adapter for local or hosted language models."""
from __future__ import annotations

import json
import os
import re
import urllib.request
from typing import Any

import numpy as np

from rl.python.env_gym import ACTION_LABELS, FarmGymEnv


def parse_action(text: str | None, mask: np.ndarray) -> int:
    """Parse a model response and guarantee a currently valid action."""
    text = text or ""
    candidates: list[Any] = []
    cleaned = text.strip().replace(chr(96) * 3 + "json", "").replace(chr(96) * 3, "").strip()
    try:
        payload = json.loads(cleaned)
        candidates.extend([payload.get("action"), payload.get("action_index")])
    except (json.JSONDecodeError, AttributeError):
        pass
    lowered = text.lower()
    candidates.extend(re.findall(r"\b(?:action\s*[:=]\s*)?(\d{1,2})\b", lowered))
    candidates.extend(label for label in ACTION_LABELS if re.search(rf"\b{re.escape(label)}\b", lowered))
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
    return int(np.flatnonzero(mask)[0])


class OpenAIActionPolicy:
    """Choose macro actions through an OpenAI-compatible chat endpoint."""

    def __init__(self, base_url: str | None = None, model: str | None = None,
                 api_key: str | None = None, timeout: float = 30.0):
        self.base_url = (base_url or os.getenv("OPENAI_BASE_URL") or "http://127.0.0.1:4000/v1").rstrip("/")
        self.model = model or os.getenv("OPENAI_MODEL") or "local-coder"
        self.api_key = api_key or os.getenv("OPENAI_API_KEY") or "sk-local"
        self.timeout = timeout

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
                "empty": obs["farmState"].count(0), "tilled": obs["farmState"].count(1),
                "seeded": obs["farmState"].count(2), "growing": obs["farmState"].count(3),
                "mature": obs["farmState"].count(4),
                "watered": sum(int(v) for v in obs.get("farmWatered", [])),
            },
            "livestock": {
                name: {
                    "owned": int((obs.get("animals") or [0, 0, 0])[index]),
                    "fed_today": bool((obs.get("animalsFedToday") or [0, 0, 0])[index]),
                }
                for index, name in enumerate(("chicken", "cow", "sheep"))
            },
            "talked_to_rhea_today": bool(obs.get("talkedRheaToday", 0)),
        }

    def choose(self, env: FarmGymEnv) -> int:
        mask = env.action_masks()
        valid = [label for index, label in enumerate(ACTION_LABELS) if mask[index]]
        prompt = {
            "state": self._state(env), "valid_actions": valid,
            "objective": "maximize long-term credits without starving",
            "response_format": {"action": "one valid action name", "reason": "short"},
        }
        body = json.dumps({
            "model": self.model,
            "messages": [
                {"role": "system", "content": "You control a deterministic farming simulation. Return JSON only."},
                {"role": "user", "content": json.dumps(prompt, separators=(",", ":"))},
            ],
            "temperature": 0,
            "max_tokens": 80,
            "chat_template_kwargs": {
                "enable_thinking": False, "reasoning_effort": "low",
            },
        }).encode("utf-8")
        request = urllib.request.Request(
            self.base_url + "/chat/completions", data=body,
            headers={"Authorization": "Bearer " + self.api_key, "Content-Type": "application/json"},
            method="POST",
        )
        with urllib.request.urlopen(request, timeout=self.timeout) as response:
            payload = json.load(response)
        message = payload["choices"][0]["message"]
        text = message.get("content") or message.get("reasoning_content")
        return parse_action(text, mask)
