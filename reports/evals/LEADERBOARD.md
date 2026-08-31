# Space Farmer model leaderboard

*No valid reports on the locked protocol yet.* The pipeline refuses to present invalid/archived runs as comparable.


## ⚠ Invalid / archived reports — NOT compared

These reports fail the validity gate (see `models.json`); they are infrastructure diagnostics, never evidence of model quality:

| Report | Model | Protocol | Reason |
|---|---|---|---|
| `deepseek-mia-masked-macro-v2-invalid.json` | deepseek-mia | `masked-macro-v2` | INVALID — archived (protocol lock): its native-action fingerprints exactly match Qwen and the deterministic first-valid fallback across all checked seeds. Retained as an infrastructure diagnostic, not evidence of model quality. |
| `qwen38-flash-longctx-masked-macro-v2-invalid.json` | qwen38-flash-longctx | `masked-macro-v2` | INVALID — archived (protocol lock): all ten native-action trajectories exactly match DeepSeek and the deterministic first-valid fallback. |
