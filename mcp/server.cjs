#!/usr/bin/env node
// mcp/server.cjs — Model Context Protocol (MCP) stdio server for Space Farmer.
//
// Wraps the authoritative RL environment (rl/env_core.cjs) in-process and
// speaks JSON-RPC 2.0 over stdio (newline-delimited) so any MCP client —
// Claude Desktop, Open WebUI, Cursor, MCP Inspector — can farm the colony
// with the SAME single-sourced tool schema the web game and the Python policy
// use. Zero drift by construction: TOOLS comes from env_core.cjs, story
// words come from shared/story/*, season math from shared/calendar.js.
//
// Run:  node mcp/server.cjs            (stdio)
// Test: node mcp/smoke.cjs             (headless client round-trip)
//
// Env controls: one deterministic episode per process (seed via
// SPACE_FARMER_SEED, default 1); the `reset` tool restarts it.
'use strict';

const readline = require('node:readline');
const path = require('node:path');

// stdout is the MCP protocol channel — all world/server chatter goes to stderr
// (the env's FarmRoom logs "Agent joined", "Day N", etc. via console.log).
console.log = (...args) => console.error(...args);
const {
  FarmEnv,
  TOOLS,
  toolArgsToNative,
  NPC_IDS,
  SEASONS,
  DAYS_PER_SEASON,
  QUESTS,
} = require(path.join(__dirname, '..', 'rl', 'env_core.cjs'));
const storyNPCs = require(path.join(__dirname, '..', 'shared', 'story', 'npcs.js'));

const SERVER_NAME = 'space-farmer';
const SERVER_VERSION = '1.0.0';
const DEFAULT_PROTOCOL = '2025-06-18';
const SUPPORTED_PROTOCOLS = new Set(['2025-06-18', '2025-03-26', '2024-11-05']);

// ── One living episode, born deterministically ──
const SEED = Number(process.env.SPACE_FARMER_SEED) || 1;
const env = new FarmEnv({ narrative: true });
env.reset({ seed: SEED });

// ── Tool surface: the W1 world-voice actions (single source) + `reset` ──
const TOOL_LIST = TOOLS.map((tool) => ({
  name: tool.name,
  description: tool.description,
  inputSchema: tool.parameters,
}));
TOOL_LIST.push({
  name: 'reset',
  description: 'Environment control (not a world action): start a fresh deterministic episode on B-612, optionally at a given seed. The colony forgets nothing, only day zero.',
  inputSchema: {
    type: 'object', additionalProperties: false,
    properties: {
      seed: { type: 'integer', minimum: 0, description: 'RNG seed for the new episode (default 1).' },
    },
  },
});

// ── Resources ────────────────────────────────────────────────────────────────
function npcProfile(id) {
  const data = storyNPCs[id] || {};
  const p = env.player() || {};
  const friends = Object.fromEntries(p.friendships || []);
  const level = friends[id] || 0;
  const loved = data.lovedGift ? `loves: ${data.lovedGift}` : '';
  const liked = data.likedGifts && data.likedGifts.length ? `likes: ${data.likedGifts.join(', ')}` : '';
  const hated = data.hatedGifts && data.hatedGifts.length ? `loathes: ${data.hatedGifts.join(', ')}` : '';
  const prefs = [loved, liked, hated].filter(Boolean).join(' · ') || 'no known gift preferences';
  return [
    `${data.name || id} — ${data.title || data.role || 'colonist'}`,
    `Friendship with you: ${level}`,
    `Gift preferences: ${prefs}`,
    `Marriage candidate: ${data.marriageCandidate ? 'yes' : 'no'}`,
  ].join('\n');
}

function yearSummary(n) {
  const cal = env.calendar;
  const day0 = (n - 1) * cal.daysPerYear + 1;
  const day1 = n * cal.daysPerYear;
  const spanning = SEASONS.map((s, i) => {
    const d0 = day0 + i * cal.daysPerSeason - 1;
    return `${SEASONS[i]} (days ${d0}-${d0 + cal.daysPerSeason - 1})`;
  }).join(' · ');
  const log = env.colonyLog.filter((entry) => {
    const m = entry.match(/^Day (\d+)/);
    return m && Number(m[1]) >= day0 && Number(m[1]) <= day1;
  });
  const logText = log.length
    ? log.join('\n')
    : 'No colony-log entries recorded for this year in this episode yet.';
  return [
    `Year ${n} on B-612 — ${spanning}`,
    '',
    logText,
  ].join('\n');
}

const RESOURCES = [
  { uri: 'farm://state', name: 'Colony state', description: 'The colony\u2019s quiet ledger: credits, energy, equipped tool + tank, inventory, farm tiles, livestock, friendships.' },
  { uri: 'farm://backpack', name: 'Backpack', description: 'What you carry right now: the equipped tool, every tool you own with its tier, the watering-can tank, and your cargo.' },
  { uri: 'farm://colony-log', name: 'Colony log', description: 'What has happened since arrival, day by day — the log remembers.' },
  ...NPC_IDS.map((id) => ({
    uri: `farm://npc/${id}`,
    name: `NPC profile — ${storyNPCs[id]?.name || id}`,
    description: 'Who a colonist is, how they feel about you, and what they like to receive.',
  })),
  { uri: 'farm://year/1', name: 'Year 1 on B-612', description: 'One calendar year of colony life: seasons and recorded days.' },
];

const RESOURCE_TEMPLATES = [
  { uriTemplate: 'farm://npc/{id}', name: 'NPC profile', description: 'Who a colonist is and their gifts/friendship with you.' },
  { uriTemplate: 'farm://year/{n}', name: 'Year summary', description: 'A full B-612 year: season spans and colony-log lines.' },
];

function readResource(uri) {
  if (uri === 'farm://state') return env.stateText();
  if (uri === 'farm://backpack') return env.backpackText();
  if (uri === 'farm://colony-log') return env.colonyLogText();
  const npcMatch = String(uri).match(/^farm:\/\/npc\/([a-z0-9_-]+)$/);
  if (npcMatch) {
    const id = npcMatch[1];
    if (!NPC_IDS.includes(id)) throw new Error(`no such colonist: ${id}`);
    return npcProfile(id);
  }
  const yearMatch = String(uri).match(/^farm:\/\/year\/(\d+)$/);
  if (yearMatch) return yearSummary(Number(yearMatch[1]));
  throw new Error(`unknown resource: ${uri}`);
}

// ── Prompts: the Keeper framing, pressure not fiat ──
const KEEPER_FRAMING = `You are the Keeper of Asteroid B-612 — one colonist among the people, not their commander.

The world is allowed to be tight and terrible; you are never commanded. Pressure is the colony's weather (debt clock, failing generator, winter, Earth Day, the envoys at the gates) — never an instruction about what you may or may not risk. You can be generous, greedy, lazy, reckless, devout, or defiant; the world will consequence you either way.

Live one day at a time. Talk to the colonist nearest you, gift what you can spare, tend the fields, keep a journal. Read your observations before acting: inspect, get_state, read_colony_log. When the day's work is done, rest (advance_day). The calendar is the story's heartbeat.`;

const PROMPTS = [
  {
    name: 'keeper-framing',
    description: 'Framing for playing Space Farmer — pressure, not fiat; free will first.',
    arguments: [],
  },
];

function getPrompt(name) {
  if (name === 'keeper-framing') {
    return {
      description: 'Framing for playing Space Farmer — pressure, not fiat; free will first.',
      messages: [
        {
          role: 'user',
          content: { type: 'text', text: KEEPER_FRAMING },
        },
      ],
    };
  }
  throw new Error(`unknown prompt: ${name}`);
}

// ── Tool execution ───────────────────────────────────────────────────────────
function runTool(name, args) {
  const a = args || {};
  switch (name) {
    case 'reset': {
      env.reset({ seed: a.seed == null ? SEED : Number(a.seed) });
      return { text: env.briefing(), ok: true, day: env.room.state.day };
    }
    case 'inspect':
      return { text: env.inspectText(String(a.target || 'colony')), ok: true };
    case 'get_state':
      return { text: env.stateText(), ok: true };
    case 'read_colony_log':
      return { text: env.colonyLogText(), ok: true };
    case 'write_journal': {
      const reply = env.writeJournal(String(a.entry || ''));
      return { text: `${reply}\n\n${env.journalText()}`, ok: true };
    }
    default: {
      const native = toolArgsToNative(name, a);
      if (!native) throw new Error(`unknown tool: ${name}`);
      const before = env.obs();
      const step = env.step(native);
      const parts = [];
      if (step.info && step.info.prose) parts.push(step.info.prose);
      else parts.push(step.info.ok ? 'The action resolves; the ledger settles.' : 'The action does not take.');
      parts.push(`Day ${step.info.day} · reward ${step.reward.toFixed(3)}` +
        (step.terminated ? ' · EPISODE COMPLETE' : '') +
        (step.truncated ? ' · HORIZON REACHED' : ''));
      if (!step.info.ok && before) {
        parts.push(`(obs unchanged — tile (${a.x},${a.y}) was not in a state that accepts ${name}.)`);
      }
      return { text: parts.join('\n'), ok: step.info.ok, day: step.info.day };
    }
  }
}

// ── JSON-RPC 2.0 plumbing (stdio, newline-delimited) ───────────────────────
function send(obj) {
  process.stdout.write(JSON.stringify(obj) + '\n');
}

function result(id, payload) {
  send({ jsonrpc: '2.0', id, result: payload });
}

function jsonrpcError(id, code, message, data) {
  send({ jsonrpc: '2.0', id, error: { code, message, data } });
}

const handlers = {
  initialize: (params, id) => {
    const requested = params && params.protocolVersion;
    const protocolVersion = SUPPORTED_PROTOCOLS.has(requested) ? requested : DEFAULT_PROTOCOL;
    result(id, {
      protocolVersion,
      capabilities: { tools: {}, resources: {}, prompts: {} },
      serverInfo: { name: SERVER_NAME, version: SERVER_VERSION },
    });
    return true;
  },
  ping: (_params, id) => {
    result(id, {});
    return true;
  },
  'tools/list': (_params, id) => {
    result(id, { tools: TOOL_LIST });
    return true;
  },
  'tools/call': (params, id) => {
    const name = params && params.name;
    const args = (params && params.arguments) || {};
    try {
      const out = runTool(name, args);
      result(id, {
        content: [{ type: 'text', text: out.text }],
        isError: !out.ok,
      });
    } catch (error) {
      result(id, {
        content: [{ type: 'text', text: String(error.message || error) }],
        isError: true,
      });
    }
    return true;
  },
  'resources/list': (_params, id) => {
    result(id, { resources: RESOURCES });
    return true;
  },
  'resources/templates/list': (_params, id) => {
    result(id, { resourceTemplates: RESOURCE_TEMPLATES });
    return true;
  },
  'resources/read': (params, id) => {
    try {
      const text = readResource(params && params.uri);
      result(id, {
        contents: [{ uri: params.uri, mimeType: 'text/plain', text }],
      });
    } catch (error) {
      jsonrpcError(id, -32002, 'resource not found', String(error.message || error));
    }
    return true;
  },
  'prompts/list': (_params, id) => {
    result(id, { prompts: PROMPTS });
    return true;
  },
  'prompts/get': (params, id) => {
    try {
      result(id, { prompt: getPrompt(params && params.name) });
    } catch (error) {
      jsonrpcError(id, -32002, 'prompt not found', String(error.message || error));
    }
    return true;
  },
};

const lines = readline.createInterface({ input: process.stdin, crlfDelay: Infinity });
lines.on('line', (line) => {
  const trimmed = line.trim();
  if (!trimmed) return;
  let msg;
  try { msg = JSON.parse(trimmed); } catch (error) { return; } // malformed → drop
  if (msg.id === undefined || msg.id === null) return;          // notification
  const handler = handlers[msg.method];
  if (!handler) {
    jsonrpcError(msg.id, -32601, `method not found: ${msg.method}`);
    return;
  }
  try { handler(msg.params || {}, msg.id); } catch (error) { jsonrpcError(msg.id, -32603, String(error.message || error)); }
});

lines.on('close', () => env.close());
process.on('SIGINT', () => { env.close(); process.exit(0); });
process.on('SIGTERM', () => { env.close(); process.exit(0); });

// Keep Node alive waiting on stdin.
if (process.stdin.isTTY) {
  console.error(`Space Farmer MCP server ready (${SERVER_NAME} v${SERVER_VERSION}). Awaiting JSON-RPC over stdio.`);
}
