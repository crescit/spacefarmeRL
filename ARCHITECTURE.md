# Architecture

Space Farmer deliberately has one game-rules implementation. Browser players,
test harnesses, Gymnasium agents, PPO policies, and language-model policies all
drive the same `FarmRoom` handler surface.

~~~mermaid
flowchart LR
    Human[Browser player] -->|WebSocket| Server[Colyseus FarmRoom]
    Server --> State[Authoritative world state]
    State --> Save[Atomic JSON saves]

    Gym[Gymnasium] --> Bridge[JSONL bridge]
    PPO[Maskable PPO] --> Gym
    LLM[OpenAI-compatible model] --> Gym
    Vector[Parallel rollout workers] --> Bridge
    Bridge --> Env[Headless FarmEnv]
    Env --> Server

    Env --> Trajectory[JSONL trajectory]
    Trajectory --> Replay[Deterministic replay]
~~~

## Runtime game

- `server.js`: Express static hosting, health endpoint, and Colyseus server.
- `server/rooms/FarmRoom.js`: authoritative mechanics and state transitions.
- `server/persistence.js`: versioned atomic saves with filesystem-safe IDs.
- `client/scenes/`: Phaser presentation and input.
- `client/systems/SpriteSystem.js`: procedural runtime artwork.
- `client/systems/NetworkSystem.js`: stable player identity and synchronization.

The browser never decides authoritative rewards, inventory, credits, crop
growth, or relationship progress. It sends intents and renders synchronized
state.

## RL boundary

`rl/env_core.cjs` constructs a headless `FarmRoom`, disables persistence,
and exposes `reset`, `step`, `save`, and `load`. It does not reimplement
the economy.

`rl/bridge.cjs` is a versioned JSON-lines process protocol. Each Python
environment owns one long-lived Node child process. This boundary is simple to
containerize and prevents Python training dependencies from entering the game
server.

`rl/python/env_gym.py` provides two levels:

- `SimBridge` accepts native action dictionaries for research and replay.
- `FarmGymEnv` exposes a compact discrete macro action for standard learners.

The macro codec chooses an eligible farm tile or inventory item while
preserving the engine's 14 action types. The action mask removes clearly
unavailable actions. Every final transition still comes from `FarmRoom`.

## Reproducibility

A seed initializes the room's Mulberry32 stream. Checkpoints store the stream
position along with player, farm, and world state. A trajectory stores its seed
and every native action; replay fails on the first divergent observation,
reward, or done flag.

Generated saves, trajectories, checkpoints, model artifacts, virtual
environments, and installed packages are ignored.

## Scaling path

`ParallelFarmEnv` starts independent Node workers and overlaps their I/O with
a thread pool. It is appropriate for local experiments. Larger runs can replace
that launcher with containers while keeping the JSONL protocol and trajectory
schema unchanged.

The optional language-model policy targets an OpenAI-compatible endpoint, so
local vLLM/LiteLLM infrastructure and hosted providers use the same adapter.
