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
  async request(type, data) {
    if (!this.room) return null;
    try {
      return await this.room.send(type, data, true);  // third arg = wait for reply
    } catch (err) {
      console.warn('request failed', type, err);
      return null;
    }
  }

  getPlayerState() {
    if (!this.room || !this.room.state) return null;
    return this.room.state.players[this.playerId];
  }

  // Pull authorative friendship/marriage/inventory into `into` (a plain object).
  syncPlayer(into) {
    const p = this.getPlayerState();
    if (!p) return;
    into.credits = p.credits;
    into.energy = p.energy;
    into.marriedTo = p.marriedTo || '';
    // friendships map
    into.friendships = into.friendships || {};
    for (const k of Object.keys(p.friendships || {})) into.friendships[k] = p.friendships[k];
    into.heartEvents = into.heartEvents || {};
    for (const k of Object.keys(p.heartEvents || {})) into.heartEvents[k] = p.heartEvents[k];
    into.inventory = into.inventory || {};
    for (const k of Object.keys(p.inventory || {})) into.inventory[k] = p.inventory[k];
  }

  getFarmState() {
    if (!this.room || !this.room.state) return null;
    return this.room.state.farms[this.playerId];
  }
}

export { NetworkSystem };
