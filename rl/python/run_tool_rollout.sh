#!/usr/bin/env bash
# One deepseek-vision tool-dialog pass (one season, one seed).
set -euo pipefail
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
cd "$ROOT"
exec .venv/bin/python3 -m rl.python.rollout_tools \
  --base-url http://Spark-e4bb.tail8fb967.ts.net:8000/v1 \
  --model deepseek-vision \
  --api-key sk-local \
  --seeds 1 --seed-start 1 \
  --horizon "1 season" \
  --max-steps 500 \
  --timeout 1800 \
  --trajectory-dir /tmp/tool-deepseek-vision \
  --diary /tmp/tool-deepseek-vision-diary
