#!/usr/bin/env bash
# One run of the RL env with the deepseek-vision LLM policy.
# Runs rollout_llm.py against the deepseek-vision OpenAI-compatible endpoint
# (spark-e4bb), records a replayable trajectory, and replays it to verify.
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
PY="$ROOT/.venv/bin/python3"
OUT="${1:-$ROOT/trajectories/llm-deepseek-vision.jsonl}"

cd "$ROOT"
exec "$PY" -m rl.python.rollout_llm \
  --base-url "http://Spark-e4bb.tail8fb967.ts.net:8000/v1" \
  --model "deepseek-vision" \
  --api-key "sk-local" \
  --seed 42 \
  --horizon-days 30 \
  --max-steps 500 \
  --output "$OUT"
