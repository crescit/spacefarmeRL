"""OpenAI-compatible policy adapter for local or hosted language models."""
from __future__ import annotations

import json
import os
import re
import urllib.request
from dataclasses import dataclass, field
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


# Tools that read the world and talk to the agent without spending a step.
# They are executed in-loop by ToolDialogPolicy against the env's narrative
# accessors (single Node authority) and answered as role:tool results.
INTROSPECTION_TOOLS = {"inspect", "get_state", "read_colony_log", "write_journal"}

# Tool → native action mapping (rest is the day's end). Introspection tools
# never reach the engine. Everything else mirrors the FarmRoom handler surface.
def native_from_tool(name: str, args: dict[str, Any]) -> dict[str, Any]:
    a = args or {}
    if name == "rest" or name == "advance_day":
        return {"type": "advance_day"}
    if name in ("till", "plant", "water", "harvest"):
        native: dict[str, Any] = {"type": name, "tileX": int(a.get("x", 0)), "tileY": int(a.get("y", 0))}
        if name == "plant":
            native["crop"] = str(a.get("crop") or "space-wheat")
        return native
    if name == "sell":
        return {"type": "sell", "item": str(a.get("item")), "quantity": int(a.get("quantity", 1))}
    if name == "buy_animal":
        return {"type": "buy_animal", "species": str(a.get("species")), "quantity": int(a.get("quantity", 1))}
    if name == "feed":
        return {"type": "feed", "species": str(a.get("species"))}
    if name in ("upgrade_tool", "mine", "claim_festival"):
        return {"type": name}
    if name == "fish":
        return {"type": "fish", "spot": str(a.get("spot") or "stardust"), "night": bool(a.get("night", False))}
    if name == "gift":
        return {"type": "gift", "npc": str(a.get("npc")), "item": str(a.get("item")), "quantity": int(a.get("quantity", 1))}
    if name == "talk":
        return {"type": "talk", "npc": str(a.get("npc"))}
    return {"type": name}


class ToolDialogPolicy(OpenAIActionPolicy):
    """The native tool-calling dialog — the anti-hellscape.

    The model is passed the real tool schema (one Node source) and talks to the
    colony through typed function calls: till(3,2), plant(x,y,crop), talk(npc),
    rest()… Every tool result comes back as prose with the world's consequence.
    The policy keeps the conversation; the runner drives the env one native
    action at a time through choose_native()/observe().
    """

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
        tools: list[dict[str, Any]] | None = None,
    ):
        super().__init__(
            base_url=base_url, model=model, api_key=api_key, timeout=timeout,
            reasoning_effort=reasoning_effort, thinking=thinking,
            max_output_tokens=max_output_tokens, retries=retries,
        )
        self.tools = list(tools or [])
        self.conversation: list[dict[str, Any]] = []
        self._pending_calls: list[Any] = []
        # validity + telemetry counters for the eval pipeline
        self.primary_tool_calls = 0
        self.retried_tool_calls = 0
        self.fallback_actions = 0
        self.text_only_turns = 0
        self.last_tool_call_id: str | None = None

    # ── day lifecycle: a new morning = a fresh turn, same keeper ──
    def begin_day(self, briefing: str) -> None:
        self.conversation = [
            {
                "role": "system",
                "content": (
                    "You are a farmer on B-612. The colony owes, the generator is "
                    "failing, winter is coming, and strangers are asking. What you do "
                    "next is entirely your choice — the world will answer honestly.\n"
                    "Call tools to work the land, talk to people, rest when your "
                    "stamina runs low. Write in your journal when a day matters. "
                    "When you are done for the day, call rest()."
                ),
            },
            {"role": "user", "content": briefing},
        ]
        self._pending_calls = []

    def choose_native(self, env: FarmGymEnv) -> dict[str, Any] | None:
        """Return the next native action, or None when the model ends its turn.

        Introspection tools (inspect/get_state/read_colony_log/write_journal)
        are answered in-loop — they never spend a world step.
        """
        while True:
            if not self._pending_calls:
                calls = self._ask_model()
                if not calls:
                    return None  # text-only turn — the keeper has spoken, day can end
                self._pending_calls = list(calls[1:])
                tool_call = calls[0]
            else:
                tool_call = self._pending_calls.pop(0)
            fn = tool_call.get("function") if isinstance(tool_call, dict) else tool_call.function
            name = fn.get("name") if isinstance(fn, dict) else fn.name
            arguments = fn.get("arguments") if isinstance(fn, dict) else fn.arguments
            call_id = tool_call.get("id") if isinstance(tool_call, dict) else tool_call.id
            self.last_tool_call_id = call_id
            try:
                args = json.loads(arguments or "{}")
            except json.JSONDecodeError:
                args = {}
            if name in INTROSPECTION_TOOLS:
                self._answer_introspection(env, name, args, call_id)
                continue
            self.primary_tool_calls += 1
            return native_from_tool(name, args)

    def observe(self, native: dict[str, Any], info: dict[str, Any]) -> None:
        """Record the world's reply to a tool the model called."""
        prose = (info or {}).get("prose") or "The world takes that quietly."
        self.conversation.append({
            "role": "tool",
            "tool_call_id": self.last_tool_call_id or "",
            "content": prose,
        })

    # ── internals ──
    def _ask_model(self) -> Any | None:
        """One chat round; returns the first tool_call and the rest as a list, or None."""
        messages = self.conversation
        attempts = 1 + self.retries
        for attempt in range(attempts):
            body = {
                "model": self.model,
                "messages": messages,
                "temperature": 0,
                "max_tokens": self.max_output_tokens if self.thinking and attempt == 0 else 96,
                "tools": self.tools or None,
                "tool_choice": "auto",
            }
            if self.thinking or attempt == 0:
                body["chat_template_kwargs"] = {
                    "enable_thinking": self.thinking and attempt == 0,
                    "thinking": self.thinking and attempt == 0,
                    "reasoning_effort": self.reasoning_effort,
                }
            payload = self._post(body)
            message = payload["choices"][0]["message"]
            finish = payload["choices"][0].get("finish_reason")
            calls = message.get("tool_calls")
            if calls:
                return list(calls)
            content = (message.get("content") or "").strip()
            # A real reply with no tool call = the keeper decided to stop acting
            # (rest, journal, or simply end the day). Retry only when the output
            # looks truncated (length cut, empty content) — otherwise we'd nag.
            if content or finish != "length":
                self.text_only_turns += 1
                return None
            self.retried_tool_calls += 1
        self.text_only_turns += 1
        return None

    def _post(self, body: dict[str, Any]) -> dict[str, Any]:
        request = urllib.request.Request(
            self.base_url + "/chat/completions",
            data=json.dumps(body).encode("utf-8"),
            headers={
                "Authorization": "Bearer " + self.api_key,
                "Content-Type": "application/json",
            },
            method="POST",
        )
        with urllib.request.urlopen(request, timeout=self.timeout) as response:
            return json.load(response)

    def _answer_introspection(self, env: FarmGymEnv, name: str, args: dict[str, Any], call_id: str) -> None:
        if name == "get_state":
            text = env.state_text()
        elif name == "read_colony_log":
            text = env.colony_log()
        elif name == "write_journal":
            text = env.write_journal(str(args.get("entry", "")))
        else:  # inspect
            text = env.inspect_text(str(args.get("target") or "colony"))
        self.conversation.append({
            "role": "tool",
            "tool_call_id": call_id,
            "content": text,
        })
