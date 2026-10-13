// NetworkSystem.js — Colyseus client connection

// A STABLE player identity, generated once and kept in localStorage so the
// server can find your save on every future visit. Without this, "persistence"
// would be keyed to a throwaway session id and every reconnect = new farm.
function getStablePlayerId() {
  try {
    let id = localStorage.getItem('sf_player_id');
    if (!id) {
      id = 'p_' + Date.now().toString(36) + '_' + Math.random().toString(36).slice(2, 8);
      localStorage.setItem('sf_player_id', id);
    }
    return id;
  } catch {
    // no localStorage (SSR / privacy mode) — fall back to a session-scoped id
    return 'p_tmp_' + Math.random().toString(36).slice(2, 8);
  }
}

// Iterate a Colyseus MapSchema (or a plain object) as [key, value] pairs.
// MapSchema hides its entries from Object.keys (they're behind $items/$indexes),
// so sync code that wants REAL keys must go through the schema's iterator or
// forEach — otherwise every sync copies internal machinery instead of data.
export function schemaEntries(m) {
  if (!m) return [];
  if (typeof m.forEach === 'function') {
    const out = [];
    m.forEach((value, key) => out.push([key, value]));
    return out;
  }
  return Object.entries(m);
}

class NetworkSystem {
  constructor() {
    this.client = null;
    this.room = null;
    this.playerId = null;
    this.connected = false;
  }

  async connect(url) {
    try {
      this.client = new Colyseus.Client(url);
      this.room = await this.client.joinOrCreate('farm', {
        name: 'Farmer',
        playerId: getStablePlayerId(),   // stable save key (survives reconnects)
      });
      this.playerId = this.room.sessionId;
      this.connected = true;
      console.log('Connected to farm room:', this.room.sessionId);

      this.room.onStateChange((state) => {
        // State sync callback — game scenes will poll state
        if (window.SpaceFarmer.onStateChange) {
          window.SpaceFarmer.onStateChange(state);
        }
      });

      // Server-side persistence pings — a quiet "SAVED" blip on the HUD
      this.room.onMessage('saved', () => {
        if (window.SpaceFarmer.onSaved) window.SpaceFarmer.onSaved();
      });

      // M3 — Earth Day spectacle: festival phase changes + the feast-peak burst
      this.room.onMessage('festivalPhase', (d) => {
        if (window.SpaceFarmer.onFestivalPhase) window.SpaceFarmer.onFestivalPhase(d);
      });
      this.room.onMessage('feastPeak', (d) => {
        if (window.SpaceFarmer.onFeastPeak) window.SpaceFarmer.onFeastPeak(d);
      });

      // P3 — reflection & reward: milestone unlocks + the morning day-summary
      this.room.onMessage('milestone', (d) => {
        if (window.SpaceFarmer.onMilestone) window.SpaceFarmer.onMilestone(d);
      });
      this.room.onMessage('daySummary', (d) => {
        if (window.SpaceFarmer.onDaySummary) window.SpaceFarmer.onDaySummary(d);
      });

      // SF62 — season's-end reckoning: the same prose face the agent season
      // gets, delivered on the day the calendar rolls into a new season.
      this.room.onMessage('seasonReckoning', (d) => {
        if (window.SpaceFarmer.onSeasonReckoning) window.SpaceFarmer.onSeasonReckoning(d);
      });

      // ROADMAP A4 — message registry: the server replies to gameplay actions
      // on the SAME channel the action was sent on (FarmRoom.dispatchGameAction
      // mirrors NetworkSystem.request()). Every server-emitted type must have a
      // registered handler, otherwise @colyseus/sdk warns per reply. These
      // listeners route a reply to a fitting window.SpaceFarmer hook when one
      // exists; otherwise they are quiet no-ops — request() adds its own
      // per-request listener, so a second listener here is belt-and-braces.
      const routeReply = (t, d) => {
        const hook = window.SpaceFarmer.onActionReply;
        if (hook) hook(t, d);
      };
      this.room.onMessage('sell', (d) => routeReply('sell', d));
      this.room.onMessage('order', (d) => routeReply('order', d));
      this.room.onMessage('buy', (d) => routeReply('buy', d));
      this.room.onMessage('gift', (d) => routeReply('gift', d));
      this.room.onMessage('talk', (d) => routeReply('talk', d));
      this.room.onMessage('propose', (d) => routeReply('propose', d));
      this.room.onMessage('newGamePlus', (d) => routeReply('newGamePlus', d));
      this.room.onMessage('buyAnimal', (d) => routeReply('buyAnimal', d));
      this.room.onMessage('feedAnimal', (d) => routeReply('feedAnimal', d));
      this.room.onMessage('fish', (d) => routeReply('fish', d));
      this.room.onMessage('mine', (d) => routeReply('mine', d));
      this.room.onMessage('cook', (d) => routeReply('cook', d));
      this.room.onMessage('deposit', (d) => routeReply('deposit', d));
      this.room.onMessage('withdraw', (d) => routeReply('withdraw', d));
      this.room.onMessage('upgradeTool', (d) => routeReply('upgradeTool', d));
      this.room.onMessage('equip', (d) => routeReply('equip', d));
      this.room.onMessage('fillWater', (d) => routeReply('fillWater', d));
      this.room.onMessage('claimFestival', (d) => routeReply('claimFestival', d));
      this.room.onMessage('contact', (d) => routeReply('contact', d));

      // Catch-all for any server type this registry does not enumerate
      // (future protocol types) — keeps live play quiet without shadowing
      // the named handlers above (named keys fire first in this SDK).
      this.room.onMessage('*', (type, msg) => {
        const hook = { saved: 'onSaved', festivalPhase: 'onFestivalPhase',
          feastPeak: 'onFeastPeak', milestone: 'onMilestone',
          daySummary: 'onDaySummary', seasonReckoning: 'onSeasonReckoning' }[type];
        if (hook && window.SpaceFarmer[hook]) window.SpaceFarmer[hook](msg);
      });

      return true;
    } catch (err) {
      console.warn('Could not connect to server, running offline', err);
      this.connected = false;
      return false;
    }
  }

  send(type, data) {
    if (this.room) {
      this.room.send(type, data);
    }
  }

  // Send a message and get the server's return value (Colyseus replies to sender).
  // NOTE: this SDK's Room.send(messageType, payload) takes ONLY two args and
  // returns void — the third "waitForReply" arg is silently ignored, so a naive
  // `await send(type, data, true)` resolves undefined and every client
  // `.then(r => ...)` takes the failure branch (no toast, stale panel). The
  // server replies via room.onMessage(type, result) — await THAT instead.
  async request(type, data) {
    if (!this.room) return null;
    let unsub = null;
    let timeout = null;
    try {
      const reply = new Promise((resolve) => {
        // onMessage returns an unsubscribe fn (nanoevents) — remove our handler
        // once it fires so repeated requests don't leak listeners.
        unsub = this.room.onMessage(type, resolve);
      });
      this.room.send(type, data);
      // Fire-and-forget messages have no server reply. Resolve null after a
      // short grace rather than hanging forever if one is passed here.
      return await Promise.race([
        reply,
        new Promise((resolve) => { timeout = setTimeout(() => resolve(null), 4000); }),
      ]);
    } catch (err) {
      console.warn('request failed', type, err);
      return null;
    } finally {
      if (timeout !== null) clearTimeout(timeout);
      if (unsub) unsub();
    }
  }

  getPlayerState() {
    if (!this.room || !this.room.state) return null;
    // Colyseus MapSchema hides entries behind $items/$indexes — bracket access
    // (`players[id]`) returns undefined; the schema's .get() is the real lookup.
    const p = this.room.state.players;
    return p && typeof p.get === 'function' ? p.get(this.playerId) : p[this.playerId];
  }

  // Pull authoritative friendship/marriage/inventory into `into` (a plain object).
  syncPlayer(into) {
    const p = this.getPlayerState();
    if (!p) return;
    into.credits = p.credits;
    into.energy = p.energy;
    into.marriedTo = p.marriedTo || '';
    into.friendships = into.friendships || {};
    for (const [k, v] of schemaEntries(p.friendships)) into.friendships[k] = v;
    into.heartEvents = into.heartEvents || {};
    for (const [k, v] of schemaEntries(p.heartEvents)) into.heartEvents[k] = v;
    into.inventory = into.inventory || {};
    for (const [k, v] of schemaEntries(p.inventory)) into.inventory[k] = v;
  }

  getFarmState() {
    if (!this.room || !this.room.state) return null;
    // Same MapSchema rule as getPlayerState — use .get() for the real lookup.
    const f = this.room.state.farms;
    return f && typeof f.get === 'function' ? f.get(this.playerId) : f[this.playerId];
  }
}

export { NetworkSystem };
