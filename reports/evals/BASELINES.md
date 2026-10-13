# Baseline season economics (30-day season, seeds 1–5)

Generated with `.venv/bin/python3 -m rl.python.benchmark --seeds 5 --json` after the
`choose_farmer` policy landed (`rl/python/benchmark.py`). One season = Node's
calendar `vocabulary.seasonDays` (30 days); every episode is one season.

| policy   | mean reward | mean credits | rewards per seed (1–5)          | harvests per seed |
| -------- | ----------- | ------------ | ------------------------------- | ----------------- |
| random   | -15.950     | 77.0         | -15.75, -15.60, -16.50, -15.80, -16.10 | 0, 1, 1, 0, 1 |
| economic | -14.600     | 140.0        | -14.60 ×5                       | 0 ×5              |
| farmer   | -11.000     | 500.0        | -11.00 ×5                       | 18 ×5             |

Gate: `rl/python/tests/test_farmer_baseline.py` prints
`farmer mean reward -11.000  economic mean reward -14.600` and asserts the farmer
finishes each season, harvests, and beats the economic baseline on seeds 1–3.

Honest verdict: a **positive** season reward is **not** reachable by the farmer
baseline yet — the fixed `dayCost` living tax (-0.5 × 30 = -15.0) dominates every
season, so even a flawless harvest loop lands at about -11.0 (Δcredits ≈ +4.0
from 18 space-wheat regrow harvests plus one starter-crop sale); closing the gap
fully needs the 120-day year (4 harvest seasons, festival payouts, quest chain,
and stamina-growth compounding), which is where the next economic probe should
look.
