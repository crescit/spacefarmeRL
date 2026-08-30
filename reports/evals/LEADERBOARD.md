# Space Farmer model leaderboard

Protocol: `masked-macro-v2` · horizon: 12 days · seeds: 1–10 (10 episodes/model)

| Model | Reward μ±σ | Credits μ±σ | Steps μ | Latency/action | Δ vs random | Gap to oracle | Replay |
|---|---:|---:|---:|---:|---:|---:|:---:|
| deepseek-mia | -15.525 ± 0.377 | 1113.5 ± 29.2 | 500.0 | 2890.2 ms (9/10 eps) | -9.290 | 24.300 | ✓ |
| qwen38-flash-longctx | -15.525 ± 0.377 | 1113.5 ± 29.2 | 500.0 | 2541.6 ms | -9.290 | 24.300 | ✓ |

Higher reward and credits are better. “Δ vs random” is model reward minus
the masked-random baseline; “Gap to oracle” is economic-baseline reward
minus model reward. Compare only reports generated with this exact protocol.
