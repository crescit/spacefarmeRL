# Model evaluation reports

This directory contains compact, reviewable evaluation summaries. Raw JSONL
trajectories remain under the ignored `trajectories/` directory because they
are reproducible from the report's seeds and can grow quickly.

## Comparable protocol

Leaderboard entries must use:

- action interface `masked-macro-v2`;
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
  --thinking \
  --reasoning-effort low \
  --resume \
  --output reports/evals/model-id.json \
  --trajectory-dir trajectories/model-id
~~~

Use a filesystem-safe model slug for the filename. The JSON report is the
committed result; trajectories are retained locally for inspection and are
validated automatically through exact replay.

Reaching `--max-steps` is recorded as a capped episode rather than a crash.
The evaluator writes a partial report after every completed seed. If a run is
interrupted, repeat the identical command with `--resume`; completed seeds are
skipped and the interrupted seed restarts. With `--resume`, a replay-valid
trajectory left by the older max-step exception is recovered as capped; because
that JSONL did not store request timing, its latency is omitted from the latency
mean and the leaderboard shows the number of latency-bearing episodes. Reports from
the earlier
`masked-macro-v1` protocol are retained under `archive/` for provenance but
must not be mixed into the current leaderboard.

Rebuild the comparison table after adding reports:

~~~bash
npm run compare:models -- \
  reports/evals/*.json \
  --markdown reports/evals/LEADERBOARD.md
~~~

Build the standalone HTML dashboard after an evaluation checkpoint or completed run:

~~~bash
npm run report:models
~~~

Open the generated [HTML dashboard](report.html) in a browser. Metrics and per-seed trajectory
rows come from report JSON; backend, checkpoint, context, quantization,
speculative decoding, hardware, thinking, and reasoning provenance live in
`models.json`. In-progress reports render their last completed checkpoint. The current Qwen and
DeepSeek reports are retained but marked invalid because their native-action
fingerprints are identical to each other and to the deterministic first-valid
fallback; they are infrastructure diagnostics, not evidence of model quality.

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
