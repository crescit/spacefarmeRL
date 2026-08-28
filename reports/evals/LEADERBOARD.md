# Space Farmer model leaderboard

Protocol: `masked-macro-v1` · horizon: 12 days · seeds: 1–10 (10 episodes/model)

| Model | Reward μ±σ | Credits μ±σ | Steps μ | Latency/action | Δ vs random | Gap to oracle | Replay |
|---|---:|---:|---:|---:|---:|---:|:---:|
| qwen38-flash-longctx | -2.500 ± 0.000 | 450.0 ± 0.0 | 54.0 | 1800.9 ms | 6.300 | 11.275 | ✓ |

Higher reward and credits are better. “Δ vs random” is model reward minus
the masked-random baseline; “Gap to oracle” is economic-baseline reward
minus model reward. Compare only reports generated with this exact protocol.
