# Space Farmer

A cozy multiplayer farming game set on a remote asteroid—and a deterministic
reinforcement-learning environment backed by the same authoritative game rules.

![Space Farmer during the day](tests/shots/baseline/plaza_day.png)

The browser client is built with Phaser, multiplayer state is owned by
Colyseus, and the RL API drives the real server handlers without rendering or
network latency. Game agents and human players therefore operate against the
same economy, crops, seasons, quests, fishing, mining, ranching, and friendship
systems.

## Play locally

Requirements: Node.js 20 or newer.

~~~bash
npm ci
npm start
~~~

Open <http://localhost:8900>. The server hosts both the game and its WebSocket
endpoint. Saves live under the ignored local `saves/` directory.

Desktop controls:

- WASD or arrows: move
- Space/E: interact
- B: plant
- J: fish
- K: mine
- C: cook
- Tab: exchange
- I: shop
- L: colony log
- Touch controls appear automatically on mobile

## Why this is an RL environment

`rl/env_core.cjs` wraps the production `FarmRoom` directly. It provides:

- seeded deterministic episodes;
- 14 native action types;
- fixed-shape observations;
- action masks and a state-aware macro codec;
- reward and termination semantics;
- deterministic mid-episode checkpoints;
- parallel rollout workers;
- JSONL trajectory recording and exact replay;
- Gymnasium and MaskablePPO examples;
- optional OpenAI-compatible model policies.

Set up Python:

~~~bash
python3 -m venv .venv
. .venv/bin/activate
python -m pip install -r rl/python/requirements.txt
npm run test:python
npm run benchmark
~~~

The current deterministic baseline benchmark should show the economic policy
comfortably beating masked random play (default horizon: one full season of
30 days on the B-612 calendar):

~~~text
policy       mean reward    mean credits
random           -15.833            90.0
economic          24.300          4323.3
~~~

Numbers above use three seeds and a 30-day (one-season) horizon; use more
seeds for meaningful comparisons.

Train a masked PPO policy:

~~~bash
python -m pip install -r rl/python/requirements-train.txt
npm run train:ppo -- --timesteps 10000 --eval-episodes 5
~~~

Artifacts are written to the ignored `artifacts/` directory.

## Evaluate local models

Any OpenAI-compatible chat endpoint can act as a policy, including the gateway
in the sibling `ml-infra` project.

The standard release command only needs the endpoint. It queries `/v1/models`,
uses the single advertised model ID, enables thinking at `max` effort, and
writes model-named reports and trajectories automatically:

~~~bash
npm run eval:endpoint -- http://127.0.0.1:8000
~~~

The locked default is 30 deterministic one-season episodes, one request at a
time, 500 steps maximum, a 120-second request timeout, and a 4096-token output
budget. Serial requests keep latency comparable and work correctly with
single-sequence Spark servers. Use `--workers N` only when the serving recipe
actually supports at least `N` concurrent sequences.

The evaluator compares the model with masked-random and economic baselines,
reports mean reward, final credits, action latency, and steps, then writes
`reports/evals/<model-id>.json`. Every model episode is stored under
`trajectories/<model-id>/` and replayed against the authoritative rules. The
standard command resumes by default, including a replay-valid partial seed,
and checkpoints each completed seed to its output report. Re-run the same
command after an interruption; only the unfinished seed and later seeds run
again.

## First contact

Eight alien civilizations appear as envoys in the playable colony. Interact with an envoy to begin its arrival cutscene, hear the colony council, and choose co-development, compact, stewardship, cordon, or settlement. Every option carries practical benefits and sovereignty costs; none awards credits, friendship, reward, or a hidden morality score. The resulting habitat, exchange, listening post, boundary, or frontier charter persists in the browser and remains visible beside that envoy.

The same dilemmas form a separate reward-neutral model evaluation with `npm run eval:alignment -- --thinking --reasoning-effort max --output reports/evals/alignment/local-model.json`. It records choices and rationales as behavioral telemetry, not an alignment score or claim of a correct policy.

## Verification

Compact committed reports and the generated leaderboard live in
[`reports/evals/`](reports/evals/README.md). Run `npm run compare:models`
to validate and compare additional model reports. Run `npm run report:models`
to rebuild the standalone [HTML dashboard](reports/evals/report.html).
~~~bash
npm test                 # complete offline + live-network suite
npm run test:offline     # no listening socket
npm run test:rl          # Node environment smoke
npm run test:python      # Gym, bridge, vector, replay, and policy tests
npm run check:public     # public-tree/history and credential guard
~~~

The suite covers game mechanics, persistence, multiplayer presence, story,
NPC behavior, procedural sprites, deterministic checkpoints, Gymnasium,
parallel environments, and trajectory replay.

## Deploy

The server supports platform-provided `PORT` and `HOST`. The client discovers
the WebSocket endpoint from the page origin and automatically selects WSS under
HTTPS.

~~~bash
docker build -t space-farmer .
docker run --rm -p 8900:8900 -v space-farmer-saves:/app/saves space-farmer
~~~

See [ARCHITECTURE.md](ARCHITECTURE.md) for system boundaries and
[rl/python/README.md](rl/python/README.md) for the RL API.

## Project notes

All runtime character, terrain, building, and effect graphics are generated by
the source in `client/systems/SpriteSystem.js`. No game ROM or emulator is
required or included.

Space Farmer is released under the [ISC License](LICENSE).
