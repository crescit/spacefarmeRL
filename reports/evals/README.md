# Model evaluation reports

This directory contains compact, reviewable evaluation summaries. Raw JSONL
trajectories remain under the ignored `trajectories/` directory because they
are reproducible from the report's seeds and can grow quickly.

## Comparable protocol

Leaderboard entries must use:

- action interface `masked-macro-v1`;
- seeds 1 through 10;
- a 12-day horizon;
- deterministic model sampling;
- the same environment revision.

Run a new model:

~~~bash
export OPENAI_BASE_URL=http://127.0.0.1:8000/v1
export OPENAI_API_KEY=sk-local
export OPENAI_MODEL=model-id

npm run eval:local-model -- \
  --seeds 10 \
  --seed-start 1 \
  --horizon-days 12 \
  --max-steps 500 \
  --timeout 120 \
  --output reports/evals/model-id.json \
  --trajectory-dir trajectories/model-id
~~~

Use a filesystem-safe model slug for the filename. The JSON report is the
committed result; trajectories are retained locally for inspection and are
validated automatically through exact replay.

Rebuild the comparison table after adding reports:

~~~bash
npm run compare:models -- \
  reports/evals/*.json \
  --markdown reports/evals/LEADERBOARD.md
~~~

The comparison command refuses to combine reports whose seeds, horizon, or
action-interface version differ. This prevents an attractive but invalid
leaderboard.

## Report interpretation

- Reward is the primary environment score.
- Credits measure economic outcome at episode end.
- Steps measure action efficiency.
- Latency is wall-clock model response time per action.
- Δ vs random measures improvement over masked-random play.
- Gap to oracle measures remaining distance from the scripted economic policy.
- Replay must be ✓ for a result to be accepted.
