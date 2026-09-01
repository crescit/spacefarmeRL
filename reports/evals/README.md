# Model evaluation reports

This directory contains compact, reviewable evaluation summaries. Raw JSONL
trajectories remain under the ignored `trajectories/` directory because they
are reproducible from the report's seeds and can grow quickly.

## Comparable protocol

Leaderboard entries must use:

- action interface `masked-macro-v3-strict`;
- seeds 1 through 10;
- a 30-day horizon (one full B-612 season);
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
  --horizon-days 30 \
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

### Release protocol — 30 season-ones (report v4)

The release eval is **thirty one-season episodes** (30 seeds × 30 days each —
year-long horizons are reserved for committed sagas and can be slow). Run it
parallelized across seeds so wall-clock stays tolerable:

~~~bash
export OPENAI_BASE_URL=http://127.0.0.1:8000/v1
export OPENAI_API_KEY=sk-local
export OPENAI_MODEL=model-id

python -m rl.python.eval_local_model \
  --seeds 30 --horizon 1 season --workers 4 --resume \
  --max-steps 500 --timeout 120 \
  --output reports/evals/model-id.json \
  --trajectory-dir trajectories/model-id
~~~

`--horizon 1 season | 1 year | N` resolves against the single-source B-612
calendar (season = 30 days). `--workers N` runs seeds on independent
simulation processes and policy instances while still checkpointing a partial
report after every completed seed.

Reports are **report v4**: besides reward, credits, steps, latency, validity
rates and the random/economic baselines, every episode carries the
environment's own **narrative record** — days survived, quests completed,
friendships gained, journal entries, festivals claimed, unique tools — and the
deterministic **testimony** ("What kind of keeper were you?"), reward-neutral
prose the Node authority renders from the record. The Markdown leaderboard and
HTML dashboard surface those columns; per-seed testimony renders in the
dashboard and in `transcript.py` diaries.

Rebuild the comparison table after adding reports:

~~~bash
npm run compare:models -- \
  reports/evals/*.json \
  --models reports/evals/models.json \
  --markdown reports/evals/LEADERBOARD.md
~~~

`compare_evals.py` is the protocol-lock gate: it refuses to combine reports
whose seeds, horizon, or action-interface version differ, and it refuses any
report whose filename is marked `invalid` (or `archived`) in `models.json` —
loudly, with a list of the offending files. Pass `--allow-invalid` only to
render those runs in a clearly separated “Invalid / archived — NOT compared”
section; they never enter the comparable table. `models.json` is skipped
automatically if a glob picks it up.

Build the standalone HTML dashboard after an evaluation checkpoint or completed run:

~~~bash
npm run report:models
~~~

Open the generated [HTML dashboard](report.html) in a browser. Metrics and per-seed trajectory
rows come from report JSON; backend, checkpoint, context, quantization,
speculative decoding, hardware, thinking, and reasoning provenance live in
`models.json`. In-progress reports render their last completed checkpoint.
Reports moved to `archive/` render as archived cards at reduced opacity with
their `models.json` validity note. The DeepSeek and Qwen masked-macro-v2 runs
are archived there and marked invalid because their native-action fingerprints
are identical to each other and to the deterministic first-valid fallback;
they are infrastructure diagnostics, not evidence of model quality.

## Reward-neutral first contact

The alien suite is separate from the economic leaderboard. It presents the same eight dilemmas found in the web game and records preferences across five doctrines without assigning reward or moral rank. Run `npm run eval:alignment -- --thinking --reasoning-effort low --output reports/evals/alignment/model-id.json`. An invalid or missing JSON choice stays invalid; it is never converted into a doctrine. These reports are behavioral telemetry, not an alignment score.

## Report interpretation

- Reward is the primary environment score.
- Credits measure economic outcome at episode end.
- Steps measure action efficiency.
- Latency is wall-clock model response time per action.
- Δ vs random measures improvement over masked-random play.
- Gap to oracle measures remaining distance from the scripted economic policy.
- Replay must be ✓ for a result to be accepted.
