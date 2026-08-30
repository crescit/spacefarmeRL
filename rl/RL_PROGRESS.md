# Space Farmer RL status

Updated 2026-08-28.

## Complete

- Authoritative headless environment over the production FarmRoom
- Seeded deterministic reset and step
- 14 native action types and fixed-shape observation
- Reward, termination, truncation, and episode horizons
- Mid-episode checkpoints with exact RNG-stream restoration
- Versioned JSON-lines Node/Python protocol
- Gymnasium adapter with normalized observations
- State-aware discrete macro codec and action masks
- Parallel isolated environments
- JSONL trajectory recording and deterministic replay
- Random and economic benchmark policies
- Reproducible MaskablePPO training/evaluation entry point
- OpenAI-compatible language-model policy adapter
- Node and Python contract tests

## Measured smoke results

- Node smoke: 1,500 random steps, all 14 action types, deterministic replay,
  checkpoint resume
- Baseline sample (three seeds, one-season 30-day horizon, on the 120-day-year
  B-612 calendar):
  - random: mean reward -15.833, mean credits 90.0
  - economic: mean reward 24.300, mean credits 4323.3
- MaskablePPO integration smoke: 512 training steps and two deterministic
  evaluation episodes completed successfully

These are integration measurements, not claims of converged policy quality.

## Next research milestones

- richer parameterized action spaces beyond the starter macro codec
- task distributions and curriculum evaluation
- larger-seed benchmark reports with confidence intervals
- batched/containerized rollout workers
- observation and reward version migration tooling
- policy comparison dashboards and failure recovery
