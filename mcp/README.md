# Space Farmer MCP server

A Model Context Protocol (MCP) **stdio** server that hands any MCP client the
keys to Asteroid B-612 — the same living colony the browser and the RL pipeline
farm. It wraps the authoritative environment
([`rl/env_core.cjs`](../rl/env_core.cjs)) in-process, so there is exactly one
tool schema, one calendar, and one story bank. No drift by construction.

*Requires Node ≥ 20.*

## Run it

~~~bash
npm run mcp          # node mcp/server.cjs — speaks JSON-RPC 2.0 over stdio
~~~

A headless smoke client drives a full session (initialize, tools, a
plant→water→harvest round trip, resources, prompts, reset):

~~~bash
npm run test:mcp     # node mcp/smoke.cjs
~~~

## What MCP clients get

- **Tools — the full W1 surface**, single-sourced from `rl/env_core.cjs`:
  `till`, `plant`, `water`, `harvest`, `sell`, `buy_animal`, `feed`,
  `upgrade_tool`, `fish`, `mine`, `gift`, `talk`, `claim_festival`, `rest`
  (the world actions), plus the eyes-and-memory tools `inspect`, `get_state`,
  `read_colony_log`, `write_journal`, and one MCP-only **environment control**
  tool — `reset(seed)` — that starts a fresh deterministic episode (clearly
  documented as *not* a world action).
- **Resources:**
  - `farm://state` — the colony’s quiet ledger (credits, energy, inventory,
    farm tiles, livestock, friendships);
  - `farm://colony-log` — what has happened since arrival, day by day;
  - `farm://npc/<id>` — a colonist’s profile: who they are, their friendship
    with you, and what they love/like/loathe;
  - `farm://year/<n>` — a full B-612 year: season spans and recorded days.
  Templates for `farm://npc/{id}` and `farm://year/{n}` are advertised via
  `resources/templates/list`.
- **Prompt** — `keeper-framing`: plays the Keeper of B-612 (pressure, not
  fiat; free will first). Optional, as a template — never an instruction.

Every tool result comes back as world voice prose plus the day/reward/state,
so the colony narrates even through a generic MCP client.

## Determinism & lifecycle

- One episode per process by default, seeded from `SPACE_FARMER_SEED`
  (default 1) — perfect for replayable agent sessions.
- World chatter (FarmRoom logs) goes to **stderr**; stdout carries only
  protocol messages, so every line on stdout is JSON-RPC 2.0.
- `reset` starts a fresh episode at a given seed without restarting the server.

## Attach from common clients

**Claude Desktop** (`claude_desktop_config.json`):

~~~json
{
  "mcpServers": {
    "space-farmer": {
      "command": "node",
      "args": ["/absolute/path/to/spacefarmer/mcp/server.cjs"],
      "env": { "SPACE_FARMER_SEED": "1" }
    }
  }
}
~~~

**Open WebUI** — add it as a *Function/Manual* tool with command
`node` and args `["/absolute/path/to/spacefarmer/mcp/server.cjs"]`
(type: `stdio`).

**Cursor** — Community settings → MCP → Add new MCP server → Type: `command`,
Command: `node`, Args: `/absolute/path/to/spacefarmer/mcp/server.cjs`.

**MCP Inspector** (debugging):

~~~bash
npx @modelcontextprotocol/inspector node mcp/server.cjs
~~~

For a standard interactive LLM session the end-to-end flow is: read
`farm://state` and `farm://colony-log` → `briefing`-style context via a tool
call or prompt → act (plant/water/harvest/talk/gift…) → `write_journal` to
remember → `rest` to end the day.
