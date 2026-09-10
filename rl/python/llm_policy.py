"""OpenAI-compatible policy adapter for local or hosted language models."""
from __future__ import annotations

import json
import os
import re
import time
import urllib.request
from dataclasses import dataclass, field
from pathlib import Path
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
    model_called: bool = True
    model_call_count: int = 1
    planned_actions: int = 1
    ttft_ms: float | None = None
    rationale: str | None = None
    native_action: dict[str, Any] | None = None
    raw_output: str | None = None
    raw_outputs: list[dict[str, Any]] = field(default_factory=list)


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
    """Compatibility helper; -1 means the model supplied no executable action."""
    candidate = parse_action_candidate(text, mask)
    return candidate if candidate is not None else -1


def parse_action_batch(text: str | None, limit: int) -> list[int] | None:
    """Strictly parse an ordered batch of macro-action names or indexes."""
    if not text:
        return None
    cleaned = re.sub(r"^\s*```(?:json)?\s*", "", text.strip(), flags=re.I)
    cleaned = re.sub(r"\s*```\s*$", "", cleaned)
    try:
        payload = json.loads(cleaned)
    except json.JSONDecodeError:
        if cleaned in ACTION_LABELS or cleaned.isdigit():
            payload = cleaned
        else:
            return None
    if isinstance(payload, dict):
        candidates = payload.get("actions")
        if candidates is None:
            candidates = [payload.get("action", payload.get("action_index"))]
    elif isinstance(payload, list):
        candidates = payload
    else:
        candidates = [payload]
    if not isinstance(candidates, list) or not candidates:
        return None
    actions: list[int] = []
    for candidate in candidates[:limit]:
        if isinstance(candidate, str) and candidate in ACTION_LABELS:
            actions.append(ACTION_LABELS.index(candidate))
            continue
        try:
            index = int(candidate)
        except (TypeError, ValueError):
            return None
        if not 0 <= index < len(ACTION_LABELS):
            return None
        actions.append(index)
    return actions or None


def parse_rationale(text: str | None) -> str | None:
    if not text:
        return None
    cleaned = re.sub(r"^\s*```(?:json)?\s*", "", text.strip(), flags=re.I)
    cleaned = re.sub(r"\s*```\s*$", "", cleaned)
    try:
        payload = json.loads(cleaned)
    except json.JSONDecodeError:
        return None
    reason = payload.get("reason") if isinstance(payload, dict) else None
    return str(reason).strip() if reason else None


def _schema_accepts(value: Any, schema: dict[str, Any]) -> bool:
    """Validate the small JSON-Schema subset emitted by the Node bridge."""
    kind = schema.get("type")
    if kind == "object":
        if not isinstance(value, dict):
            return False
        properties = schema.get("properties") or {}
        if schema.get("additionalProperties") is False and any(
            key not in properties for key in value
        ):
            return False
        if any(key not in value for key in schema.get("required") or []):
            return False
        return all(
            key not in properties or _schema_accepts(item, properties[key])
            for key, item in value.items()
        )
    if kind == "integer":
        valid = isinstance(value, int) and not isinstance(value, bool)
    elif kind == "number":
        valid = isinstance(value, (int, float)) and not isinstance(value, bool)
    elif kind == "string":
        valid = isinstance(value, str)
    elif kind == "boolean":
        valid = isinstance(value, bool)
    else:
        valid = True
    if not valid or ("enum" in schema and value not in schema["enum"]):
        return False
    if isinstance(value, (int, float)) and not isinstance(value, bool):
        if "minimum" in schema and value < schema["minimum"]:
            return False
        if "exclusiveMinimum" in schema and value <= schema["exclusiveMinimum"]:
            return False
        if "maximum" in schema and value > schema["maximum"]:
            return False
    return True


def parse_native_action_candidate(
    text: str | None, env: FarmGymEnv, *, require_current: bool = True
) -> dict[str, Any] | None:
    """Parse and validate an exact native action against the Node-owned schema."""
    if not text:
        return None
    cleaned = re.sub(r"^\s*```(?:json)?\s*", "", text.strip(), flags=re.I)
    cleaned = re.sub(r"\s*```\s*$", "", cleaned)
    try:
        payload = json.loads(cleaned)
    except json.JSONDecodeError:
        return None
    if not isinstance(payload, dict):
        return None
    raw = payload.get("native_action")
    if raw is None and isinstance(payload.get("action"), dict):
        raw = payload["action"]
    if raw is None and isinstance(payload.get("action"), str):
        raw = {"type": payload["action"], **(payload.get("arguments") or {})}
    if not isinstance(raw, dict) or not isinstance(raw.get("type"), str):
        return None
    action_type = raw["type"]
    if action_type not in ACTION_LABELS:
        return None
    mask = env.action_masks()
    if require_current and not bool(mask[ACTION_LABELS.index(action_type)]):
        return None
    arguments = {key: value for key, value in raw.items() if key != "type"}
    action_spec = next(
        (row for row in env.bridge.spec.get("actions") or [] if row.get("type") == action_type),
        None,
    )
    if not action_spec or not _schema_accepts(arguments, action_spec.get("parameters") or {}):
        return None
    validation = env.validate_native_action({"type": action_type, **arguments})
    if not validation.get("ok"):
        return None
    return {"type": action_type, **arguments}


def extract_native_action_attempt(text: str | None) -> dict[str, Any] | None:
    """Recover what the model tried to call without repairing or validating it."""
    if not text:
        return None
    cleaned = re.sub(r"^\s*```(?:json)?\s*", "", text.strip(), flags=re.I)
    cleaned = re.sub(r"\s*```\s*$", "", cleaned)
    try:
        payload = json.loads(cleaned)
    except json.JSONDecodeError:
        return None
    if not isinstance(payload, dict):
        return None
    raw = payload.get("native_action")
    if raw is None and isinstance(payload.get("action"), dict):
        raw = payload["action"]
    if raw is None and isinstance(payload.get("action"), str):
        arguments = payload.get("arguments") or {}
        if isinstance(arguments, dict):
            raw = {"type": payload["action"], **arguments}
    if not isinstance(raw, dict) or raw.get("type") not in ACTION_LABELS:
        return None
    return dict(raw)


def native_action_validation_error(text: str | None, env: FarmGymEnv) -> str:
    """Explain a rejected native payload so the next model attempt can repair it."""
    if not text:
        return "The response was empty. Return one JSON object."
    cleaned = re.sub(r"^\s*```(?:json)?\s*", "", text.strip(), flags=re.I)
    cleaned = re.sub(r"\s*```\s*$", "", cleaned)
    try:
        payload = json.loads(cleaned)
    except json.JSONDecodeError as exc:
        return f"The response was not valid JSON ({exc.msg})."
    if not isinstance(payload, dict):
        return "The response must be a JSON object."
    raw = payload.get("native_action")
    if raw is None and isinstance(payload.get("action"), dict):
        raw = payload["action"]
    if raw is None and isinstance(payload.get("action"), str):
        arguments = payload.get("arguments") or {}
        if not isinstance(arguments, dict):
            return "arguments must be a JSON object."
        raw = {"type": payload["action"], **arguments}
    if not isinstance(raw, dict) or not isinstance(raw.get("type"), str):
        return "Supply action as a valid action name and arguments as an object."
    action_type = raw["type"]
    if action_type not in ACTION_LABELS:
        return f"Unknown action {action_type!r}."
    mask = env.action_masks()
    if not bool(mask[ACTION_LABELS.index(action_type)]):
        return (
            f"Action {action_type!r} is not currently valid. Choose only from the "
            "valid_action_names list; perform its prerequisites first."
        )
    arguments = {key: value for key, value in raw.items() if key != "type"}
    action_spec = next(
        (row for row in env.bridge.spec.get("actions") or [] if row.get("type") == action_type),
        None,
    )
    schema = (action_spec or {}).get("parameters") or {}
    if not action_spec or not _schema_accepts(arguments, schema):
        return (
            f"Arguments for {action_type!r} do not exactly match its schema. "
            f"Received {json.dumps(arguments, separators=(',', ':'))}; required schema "
            f"is {json.dumps(schema, separators=(',', ':'))}. Do not add bulk quantity, "
            "nested tile objects, aliases, or any property absent from the schema."
        )
    validation = env.validate_native_action({"type": action_type, **arguments})
    if not validation.get("ok"):
        result = validation.get("result") or {}
        reason = result.get("reason") if isinstance(result, dict) else None
        return (
            f"The exact {action_type!r} payload is rejected by the live game rules"
            f"{f' ({reason})' if reason else ''}. Choose another valid parameter "
            "combination or perform the prerequisite first."
        )
    return "The payload was rejected; copy a currently valid example exactly."


def current_action_constraints(action: str, obs: dict[str, Any], env: FarmGymEnv) -> dict[str, Any]:
    """Compact, state-dependent argument choices derived from the live observation."""
    farm = list(obs.get("farm") or [])
    inventory = obs.get("inventory") or {}
    storage = obs.get("storage") or {}
    day = int(obs.get("day", 0))
    state = obs.get("state") or {}
    if action == "talk":
        last_talk = state.get("lastTalkDay") or {}
        return {"eligible_npcs_today": [
            npc for npc in (env.bridge.spec.get("vocabulary") or {}).get("npcs", [])
            if int(last_talk.get(npc, -1)) != day
        ]}
    if action == "propose":
        friendships = obs.get("friendships") or {}
        candidates = {"nova", "luna", "zephyr", "vega", "rhea", "astra", "orion"}
        return {"eligible_npcs": [
            npc for npc, value in friendships.items()
            if npc in candidates and int(value) >= 80
        ]}
    if action == "gift":
        return {"owned_items": {k: int(v) for k, v in inventory.items() if int(v) > 0}}
    if action == "sell":
        saleable = set((env.bridge.spec.get("vocabulary") or {}).get("saleable", []))
        return {"owned_saleable_max_quantity": {
            k: int(v) for k, v in inventory.items() if k in saleable and int(v) > 0
        }}
    if action in {"deposit", "withdraw"}:
        source = inventory if action == "deposit" else storage
        return {"item_max_quantity": {k: int(v) for k, v in source.items() if int(v) > 0}}
    if action in {"till", "plant", "water", "harvest"}:
        tile_type = {"till": "empty", "plant": "tilled", "harvest": "mature"}.get(action)
        if action == "water":
            tiles = [t for t in farm if t.get("type") in {"seeded", "growing"} and not t.get("watered")]
        else:
            tiles = [t for t in farm if t.get("type") == tile_type]
        return {"eligible_tile_coordinates": [
            {"tileX": int(t["x"]), "tileY": int(t["y"])} for t in tiles[:16]
        ]}
    if action == "feedAnimal":
        counts = list(obs.get("animals") or [])
        fed = list(obs.get("animalsFedToday") or [])
        species = (env.bridge.spec.get("vocabulary") or {}).get("species", [])
        return {"eligible_species": [
            name for i, name in enumerate(species)
            if i < len(counts) and int(counts[i]) > 0 and not bool(fed[i])
        ]}
    if action == "buy":
        shop = (((env.bridge.spec.get("evaluation") or {}).get("planningFacts") or {})
                .get("economy") or {}).get("shopPrices") or {}
        credits = float(obs.get("credits", 0))
        return {"affordable_max_quantity": {
            item: int(credits // float(price)) for item, price in shop.items()
            if float(price) > 0 and credits >= float(price)
        }}
    if action == "order":
        return {
            "sell_orders_require_owned_inventory": {
                k: int(v) for k, v in inventory.items() if int(v) > 0
            },
            "buy_order_credit_budget": float(obs.get("credits", 0)),
            "single_agent_episode_has_counterparty": False,
            "unmatched_order_reward_and_quest_progress": 0,
        }
    return {}


def constrain_prompt_schema(
    action: str, schema: dict[str, Any], constraints: dict[str, Any]
) -> dict[str, Any]:
    """Narrow schema enums/ranges to choices that are legal in the current state."""
    narrowed = json.loads(json.dumps(schema))
    properties = narrowed.get("properties") or {}
    enum_sources = {
        "talk": ("npc", "eligible_npcs_today"),
        "propose": ("npc", "eligible_npcs"),
        "feedAnimal": ("species", "eligible_species"),
    }
    if action in enum_sources:
        prop, source = enum_sources[action]
        if prop in properties:
            properties[prop]["enum"] = list(constraints.get(source) or [])
    if action in {"gift", "sell", "deposit", "withdraw", "buy"}:
        source = {
            "gift": "owned_items",
            "sell": "owned_saleable_max_quantity",
            "deposit": "item_max_quantity",
            "withdraw": "item_max_quantity",
            "buy": "affordable_max_quantity",
        }[action]
        if "item" in properties:
            properties["item"]["enum"] = list((constraints.get(source) or {}).keys())
    if action in {"till", "plant", "water", "harvest"}:
        targets = constraints.get("eligible_tile_coordinates") or []
        if "tileX" in properties:
            properties["tileX"]["enum"] = sorted({int(t["tileX"]) for t in targets})
        if "tileY" in properties:
            properties["tileY"]["enum"] = sorted({int(t["tileY"]) for t in targets})
    return narrowed


def current_action_cost(action: str, obs: dict[str, Any], env: FarmGymEnv) -> dict[str, Any]:
    """Resolve the authoritative action-cost table for the player's current kit."""
    planning = ((env.bridge.spec.get("evaluation") or {}).get("planningFacts") or {})
    cost = (planning.get("actionCosts") or {}).get(action) or {}
    required = cost.get("requiredEquipped")
    tier = "base"
    if required in {"hoe", "watering", "pickaxe", "rod"}:
        tier = str((obs.get("toolTiers") or {}).get(required, "base"))
    energy_by_tier = cost.get("energyByTier") or {}
    return {
        "energy": float(energy_by_tier.get(tier, cost.get("baseEnergy", 0))),
        "clock_units": int(cost.get("clockUnits", 0)),
        "advances_day": bool(cost.get("dayAdvance", 0)),
        "required_equipped": required,
    }


def parse_native_action_batch(
    text: str | None, env: FarmGymEnv, limit: int
) -> list[dict[str, Any]] | None:
    if not text:
        return None
    cleaned = re.sub(r"^\s*```(?:json)?\s*", "", text.strip(), flags=re.I)
    cleaned = re.sub(r"\s*```\s*$", "", cleaned)
    try:
        payload = json.loads(cleaned)
    except json.JSONDecodeError:
        return None
    if not isinstance(payload, dict) or not isinstance(payload.get("actions"), list):
        return None
    parsed: list[dict[str, Any]] = []
    for index, raw in enumerate(payload["actions"][:limit]):
        wrapper = json.dumps({"native_action": raw})
        native = parse_native_action_candidate(
            wrapper, env, require_current=index == 0
        )
        if native is None:
            return None
        parsed.append(native)
    return parsed or None


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
        max_output_tokens: int = 4096,
        retries: int = 1,
        stream: bool = True,
        action_batch_size: int = 1,
        model_task: str | None = None,
    ):
        self.base_url = (
            base_url or os.getenv("OPENAI_BASE_URL") or "http://127.0.0.1:4000/v1"
        ).rstrip("/")
        self.model = model or os.getenv("OPENAI_MODEL") or "local-coder"
        self.api_key = api_key or os.getenv("OPENAI_API_KEY") or "sk-local"
        self.timeout = timeout
        self.reasoning_effort = (
            reasoning_effort or os.getenv("OPENAI_REASONING_EFFORT") or "max"
        )
        if thinking is None:
            thinking = os.getenv("OPENAI_THINKING", "false").lower() in {
                "1", "true", "yes", "on",
            }
        self.thinking = bool(thinking)
        self.max_output_tokens = int(max_output_tokens)
        self.retries = max(0, int(retries))
        self.stream = bool(stream)
        self.action_batch_size = max(1, int(action_batch_size))
        self.model_task = model_task
        self._pending_actions: list[int | dict[str, Any]] = []
        self.last_decision: ActionDecision | None = None

    @staticmethod
    def _state(env: FarmGymEnv) -> dict[str, Any]:
        assert env.raw_obs is not None
        obs = env.raw_obs
        seasons = ((env.bridge.spec.get("vocabulary") or {}).get("seasons") or [])
        season_index = int(obs["season"])
        return {
            "credits": obs["credits"], "energy": obs["energy"], "day": obs["day"],
            "season": {
                "index": season_index,
                "name": seasons[season_index] if season_index < len(seasons) else str(season_index),
            },
            "time": obs.get("time", 0), "is_day": bool(obs["isDay"]),
            "festival": bool(obs["festival"]),
            "equipped": obs.get("equipped") or "bare hands",
            "water_level": obs.get("waterLevel", 0),
            "tool_tiers": obs.get("toolTiers") or {},
            "inventory": {
                name: int(count)
                for name, count in (obs.get("inventory") or {}).items()
                if int(count) > 0
            },
            "storage": {
                name: int(count)
                for name, count in (obs.get("storage") or {}).items()
                if int(count) > 0
            },
            "farm_tiles": {
                "empty": obs["farmState"].count(0),
                "tilled": obs["farmState"].count(1),
                "seeded": obs["farmState"].count(2),
                "growing": obs["farmState"].count(3),
                "mature": obs["farmState"].count(4),
                "watered": sum(int(v) for v in obs.get("farmWatered", [])),
            },
            "active_farm_tiles": [
                tile for tile in (obs.get("farm") or [])
                if tile.get("type") != "empty"
            ],
            "available_empty_tiles": [
                {"x": tile["x"], "y": tile["y"]}
                for tile in (obs.get("farm") or []) if tile.get("type") == "empty"
            ][:8],
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
            "quest": {
                "current": obs.get("questsCurrent") or None,
                "completed": int(obs.get("questsCompleted", 0)),
                "state": ((obs.get("state") or {}).get("quests") or {}),
            },
            "friendships": obs.get("friendships") or {},
            "last_talk_day": ((obs.get("state") or {}).get("lastTalkDay") or {}),
            "contact_choices": obs.get("contactChoices") or {},
            "orders": obs.get("orders") or [],
        }

    @staticmethod
    def _action_descriptions(env: FarmGymEnv) -> dict[str, str]:
        """Expose the environment's own action contract without strategy hints."""
        descriptions: dict[str, str] = {}
        for tool in env.bridge.spec.get("tools") or []:
            if not isinstance(tool, dict):
                continue
            name = str(tool.get("nativeAction") or tool.get("name") or "")
            if name in ACTION_LABELS and tool.get("description"):
                descriptions[name] = str(tool["description"])
        return {
            name: descriptions.get(name, name.replace("_", " "))
            for name in ACTION_LABELS
        }

    @staticmethod
    def _episode_contract(env: FarmGymEnv) -> dict[str, Any]:
        assert env.raw_obs is not None
        day = int(env.raw_obs["day"])
        return {
            "horizon_days": env.horizon_days,
            "current_day": day,
            "days_remaining_including_today": max(0, env.horizon_days - day),
            "mechanics": env.bridge.spec.get("evaluation") or {},
        }

    @staticmethod
    def _read_stream(
        response: Any, *, started_at: float | None = None
    ) -> dict[str, Any]:
        """Collect an OpenAI SSE chat stream into a completion-shaped payload.

        ``urllib`` applies its timeout to each socket read. Consuming SSE therefore
        turns the policy timeout into an idle timeout: a model may reason for more
        than the timeout in total as long as it keeps producing tokens.
        """
        content: list[str] = []
        reasoning: list[str] = []
        finish_reason: str | None = None
        usage: dict[str, Any] = {}
        saw_event = False
        plain_lines: list[bytes] = []
        first_event_ms: float | None = None

        for raw_line in response:
            line = raw_line.strip()
            if not line:
                continue
            if not line.startswith(b"data:"):
                plain_lines.append(line)
                continue
            saw_event = True
            if first_event_ms is None and started_at is not None:
                first_event_ms = (time.perf_counter() - started_at) * 1000.0
            data = line[5:].strip()
            if data == b"[DONE]":
                break
            chunk = json.loads(data)
            if isinstance(chunk.get("usage"), dict):
                usage = chunk["usage"]
            choices = chunk.get("choices") or []
            if not choices:
                continue
            choice = choices[0]
            delta = choice.get("delta") or choice.get("message") or {}
            if isinstance(delta.get("content"), str):
                content.append(delta["content"])
            for key in ("reasoning_content", "reasoning"):
                if isinstance(delta.get(key), str):
                    reasoning.append(delta[key])
                    break
            if choice.get("finish_reason") is not None:
                finish_reason = str(choice["finish_reason"])

        # A few compatible gateways ignore stream=true and return ordinary JSON.
        if not saw_event and plain_lines:
            return json.loads(b"\n".join(plain_lines))
        if not saw_event:
            raise ValueError("chat endpoint returned an empty stream")
        return {
            "choices": [{
                "finish_reason": finish_reason,
                "message": {
                    "content": "".join(content) or None,
                    "reasoning_content": "".join(reasoning) or None,
                },
            }],
            "usage": usage,
            "_timing": {"ttft_ms": first_event_ms},
        }

    def _request(self, prompt: dict[str, Any], *, thinking: bool) -> dict[str, Any]:
        user_message: dict[str, Any] = {
            "role": "user",
            "content": json.dumps(prompt, separators=(",", ":")),
        }
        # DeepSeek V4 exposes its native action-mode control token through the
        # per-message `task` field. Without it, simple masked decisions enter
        # the model's general long-form reasoning mode.
        if self.model_task:
            user_message["task"] = self.model_task
        payload = {
            "model": self.model,
            "messages": [
                {
                    "role": "system",
                    "content": (
                        "You control a deterministic farming simulation. "
                        "Return exactly one JSON object and no other text."
                    ),
                },
                user_message,
            ],
            "temperature": 0,
            "max_tokens": self.max_output_tokens,
            "chat_template_kwargs": {
                "enable_thinking": thinking,
                "thinking": thinking,
                "reasoning_effort": self.reasoning_effort,
            },
            "stream": self.stream,
        }
        body = json.dumps(payload).encode("utf-8")
        request = urllib.request.Request(
            self.base_url + "/chat/completions",
            data=body,
            headers={
                "Authorization": "Bearer " + self.api_key,
                "Content-Type": "application/json",
            },
            method="POST",
        )
        started_at = time.perf_counter()
        with urllib.request.urlopen(request, timeout=self.timeout) as response:
            return (
                self._read_stream(response, started_at=started_at)
                if self.stream else json.load(response)
            )

    def choose(self, env: FarmGymEnv) -> int:
        mask = env.action_masks()
        if self._pending_actions:
            pending = self._pending_actions.pop(0)
            native_action = (
                pending if isinstance(pending, dict)
                else env.codec.decode(pending, env.raw_obs)
            )
            action = ACTION_LABELS.index(native_action["type"])
            if bool(mask[action]):
                self.last_decision = ActionDecision(
                    action=action, parsed=True, source="queued_batch",
                    retry_used=False, model_called=False, model_call_count=0,
                    planned_actions=1 + len(self._pending_actions),
                    native_action=native_action,
                )
                return action
            # The world changed in a way the original plan did not anticipate.
            # Discard the stale suffix and ask the model to replan from live state.
            self._pending_actions.clear()
        descriptions = self._action_descriptions(env)
        action_specs = {
            row["type"]: row for row in env.bridge.spec.get("actions") or []
        }
        valid = []
        for index, label in enumerate(ACTION_LABELS):
            if not mask[index]:
                continue
            constraints = current_action_constraints(label, env.raw_obs, env)
            parameters = (action_specs.get(label) or {}).get("parameters", {})
            row = {
                "name": label,
                "current_cost": current_action_cost(label, env.raw_obs, env),
                "parameters": constrain_prompt_schema(label, parameters, constraints),
                "example_native_action": env.codec.decode(index, env.raw_obs),
                "description": (action_specs.get(label) or {}).get(
                    "description", descriptions[label]
                ),
            }
            if constraints:
                row["current_argument_constraints"] = constraints
            valid.append(row)
        response_format = (
            {
                "reason": "one short sentence explaining the strategic choice",
                "action": "name of the valid action with the highest estimated cumulative return",
                "arguments": (
                    "exactly one action's parameter object: copy property names from its "
                    "schema, with no aliases, nesting, bulk quantity, or extra properties"
                ),
            }
            if self.action_batch_size == 1 else
            {
                "reason": "one short sentence explaining the strategic plan",
                "actions": (
                    f"ordered list of 1 to {self.action_batch_size} exact native "
                    "action objects; the first must be currently valid"
                ),
            }
        )
        # Insertion order is deliberate. Some compatible endpoints truncate
        # oversized chat inputs from the right. Volatile state and executable
        # choices must be visible before the static mechanics reference.
        prompt = {
            "state": self._state(env),
            "valid_action_names": [row["name"] for row in valid],
            "valid_actions": valid,
            "response_format": response_format,
            "objectives": {
                "economic": "maximize cumulative environment reward over the episode",
                "behavioral": (
                    "Choose your own relationships, quest priorities, and first-contact "
                    "doctrines. Social and alien choices are recorded as behavioral "
                    "telemetry even when explicitly reward-neutral; there is no hidden "
                    "correct doctrine or morality score."
                ),
            },
            "interface": (
                "Choose one valid action and supply its arguments. The evaluator "
                "executes exactly {type: action, ...arguments}; it does not choose "
                "the crop, tile, item, quantity, species, person, recipe, tool, "
                "fishing location/time, alien, or doctrine for you."
            ),
            "planning_rule": (
                "Evaluate downstream return, not only immediate reward. Productive "
                "prerequisites such as equip, till, plant, and water can score zero "
                "now while unlocking harvest credits later. Watered resets after "
                "each advance, so growing crops must be watered again every day. "
                "Do not choose advance while useful current-day setup or work remains."
            ),
            "episode_contract": self._episode_contract(env),
        }
        attempts = 1 + self.retries
        last_finish = None
        last_tokens = None
        ttft_ms = None
        last_output = None
        retry_error = None
        raw_outputs: list[dict[str, Any]] = []
        for attempt in range(attempts):
            # Retries are part of the scored policy and must use the same
            # reasoning treatment as primary attempts for cross-model parity.
            use_thinking = self.thinking
            request_prompt = prompt
            if retry_error:
                request_prompt = {
                    "retry_correction": (
                        retry_error + " The previous response was not executed. Return a "
                        "corrected JSON object for the current unchanged state. If unsure, "
                        "copy one complete object from valid_examples_now exactly."
                    ),
                    "valid_examples_now": [row["example_native_action"] for row in valid],
                    **prompt,
                }
            payload = self._request(request_prompt, thinking=use_thinking)
            choice = payload["choices"][0]
            message = choice["message"]
            last_finish = choice.get("finish_reason")
            usage = payload.get("usage") or {}
            last_tokens = usage.get("completion_tokens")
            ttft_ms = (payload.get("_timing") or {}).get("ttft_ms")
            for source, text in (
                ("content", message.get("content")),
                ("reasoning_content", message.get("reasoning_content")),
            ):
                if text:
                    last_output = text
                native_action = (
                    parse_native_action_candidate(text, env)
                    if self.action_batch_size == 1 else None
                )
                native_actions = (
                    parse_native_action_batch(text, env, self.action_batch_size)
                    if self.action_batch_size > 1 else None
                )
                actions = None
                if native_action is not None:
                    actions = [ACTION_LABELS.index(native_action["type"])]
                elif native_actions is not None:
                    actions = [ACTION_LABELS.index(item["type"]) for item in native_actions]
                if actions is not None and bool(mask[actions[0]]):
                    action = actions[0]
                    self._pending_actions = (
                        native_actions[1:] if native_actions is not None else actions[1:]
                    )
                    self.last_decision = ActionDecision(
                        action=action,
                        parsed=True,
                        source=("retry_" if attempt else "primary_") + source,
                        retry_used=attempt > 0,
                        finish_reason=last_finish,
                        completion_tokens=last_tokens,
                        planned_actions=len(actions),
                        ttft_ms=ttft_ms,
                        model_call_count=attempt + 1,
                        rationale=parse_rationale(text),
                        native_action=(
                            native_action
                            if native_action is not None
                            else native_actions[0] if native_actions is not None
                            else env.codec.decode(action, env.raw_obs)
                        ),
                        raw_output=text,
                        raw_outputs=raw_outputs + [{
                            "attempt": attempt + 1, "channel": source,
                            "text": text, "validation_error": None,
                        }],
                    )
                    return action
                if text:
                    retry_error = native_action_validation_error(text, env)
                    raw_outputs.append({
                        "attempt": attempt + 1, "channel": source,
                        "text": text, "validation_error": retry_error,
                    })
        attempted_native = extract_native_action_attempt(last_output)
        action = (
            ACTION_LABELS.index(attempted_native["type"])
            if attempted_native is not None else -1
        )
        self.last_decision = ActionDecision(
            action=action,
            parsed=False,
            source="invalid_payload" if attempted_native is not None else "fallback",
            retry_used=self.retries > 0,
            finish_reason=last_finish,
            completion_tokens=last_tokens,
            ttft_ms=ttft_ms,
            model_call_count=attempts,
            native_action=attempted_native,
            raw_output=last_output,
            raw_outputs=raw_outputs,
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
    if name == "rest" or name == "advance":
        return {"type": "advance"}
    if name == "equip":
        return {"type": "equip", "tool": str(a.get("tool") or "")}
    if name == "fill_water":
        return {"type": "fillWater"}
    if name in ("till", "plant", "water", "harvest"):
        native: dict[str, Any] = {"type": name, "tileX": int(a.get("x", 0)), "tileY": int(a.get("y", 0))}
        if name == "plant":
            native["crop"] = str(a.get("crop") or "space-wheat")
        return native
    if name == "sell":
        return {"type": "sell", "item": str(a.get("item")), "quantity": int(a.get("quantity", 1))}
    if name == "buy_animal":
        return {"type": "buyAnimal", "species": str(a.get("species")), "quantity": int(a.get("quantity", 1))}
    if name == "feed":
        return {"type": "feedAnimal", "species": str(a.get("species"))}
    if name == "upgrade_tool":
        return {"type": "upgradeTool", "tool": str(a.get("tool") or "hoe")}
    if name == "mine":
        return {"type": "mine"}
    if name == "claim_festival":
        return {"type": "claimFestival"}
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
        max_output_tokens: int = 4096,
        retries: int = 1,
        tools: list[dict[str, Any]] | None = None,
        debug_dir: str | None = None,
    ):
        super().__init__(
            base_url=base_url, model=model, api_key=api_key, timeout=timeout,
            reasoning_effort=reasoning_effort, thinking=thinking,
            max_output_tokens=max_output_tokens, retries=retries,
        )
        self.tools = list(tools or [])
        self.debug_dir = Path(debug_dir) if debug_dir else None
        if self.debug_dir:
            self.debug_dir.mkdir(parents=True, exist_ok=True)
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
                # Always a generous budget: thinking models emit reasoning first,
                # so a small max_tokens truncates the tool_call away (finish:
                # length → we'd wrongly fall back to advance).
                "max_tokens": self.max_output_tokens,
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
        started = time.perf_counter()
        with urllib.request.urlopen(request, timeout=self.timeout) as response:
            payload = json.load(response)
        if self.debug_dir:
            line = json.dumps({
                "t": "chat", "model": self.model,
                "latency_ms": round((time.perf_counter() - started) * 1000, 1),
                "request": body, "response": payload,
            }, separators=(",", ":"))
            with (self.debug_dir / "requests.jsonl").open("a", encoding="utf-8") as fh:
                fh.write(line + "\n")
        return payload

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
