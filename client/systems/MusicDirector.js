// MusicDirector.js - generative WebAudio soundtrack for Space Farmer.
// Synthesizes an infinite, seamless soundtrack: warm pads, gentle arpeggios,
// bass and optional drone. Distinct mood per season (bright spring to cozy
// winter) and per activity (fishing calm, mining driving, interior warm,
// intro/ship spacey). Crossfades on context change so music never "cuts off".

const SEMIS = { C:0,'C#':1,Db:1,D:2,'D#':3,Eb:3,E:4,F:5,'F#':6,Gb:6,G:7,'G#':8,Ab:8,A:9,'A#':10,Bb:10,B:11 };

class MusicDirector {
  constructor() {
    this.ctx = null;          // AudioContext (created on first user gesture)
    this.master = null;       // master gain -> destination
    this.timer = null;        // lookahead scheduler interval
    this.barIndex = 0;        // chord progressor
    this.nextBar = 0;         // clock time of next scheduled bar
    this.context = 'planet'; // planet | interior | cutscene | intro | ship
    this.activity = null;     // null | fishing | mining
    this.season = 0;          // 0 spring, 1 summer, 2 fall, 3 winter
    this.verb = null;         // shared convolution reverb (added later if cheap)
    this.muted = false;      // user mute (toggled by the 🔊 button)
    this.vol = 0.5;          // normal master volume
  }

  // Call from a user gesture (autoplay policy). Safe to call repeatedly.
  ensure() {
    if (this.ctx) { if (this.ctx.state === 'suspended') this.ctx.resume(); return; }
    const Ctx = window.AudioContext || window.webkitAudioContext;
    if (!Ctx) return;
    this.ctx = new Ctx();
    this.master = this.ctx.createGain();
    this.master.gain.value = 0.0;
    this.master.connect(this.ctx.destination);
    // gentle fade-in so the song emerges, not snaps (respects current mute)
    this.master.gain.linearRampToValueAtTime(this.muted ? 0.0 : this.vol, this.ctx.currentTime + 2.5);
    this.nextBar = this.ctx.currentTime;   // start scheduling at "now", not the epoch
    this.timer = setInterval(() => this.tick(), 90);
  }

  setSeason(s) { if (s !== this.season) { this.season = s; } }
  setActivity(a) { if (a !== this.activity) { this.activity = a; } }
  setContext(c) { if (c !== this.context) { this.context = c; } }
  // M3 — Earth Day: brighter, faster, with a melody layer over the pad.
  setMood(m) { if (m !== this.mood) { this.mood = m; } }
  // Mute/unmute the whole generative soundtrack (master gain).
  setMuted(m) {
    this.muted = !!m;
    if (this.ctx && this.master) {
      const target = this.muted ? 0 : this.vol;
      this.master.gain.cancelScheduledValues(this.ctx.currentTime);
      this.master.gain.setTargetAtTime(target, this.ctx.currentTime, 0.05);
    }
  }

  tempo() { return this.config().tempo; }

  config() {
    const seasons = {
      0: { chords: ['C4','Am3','F3','G3'], tempo: 86, warm: 1.0, minor: false },
      1: { chords: ['C4','G3','Am3','F3'], tempo: 102, warm: 1.1, minor: false },
      2: { chords: ['Am3','F3','C4','G3'], tempo: 82, warm: 0.9, minor: true },
      3: { chords: ['Am3','Dm3','Em3','Am3'], tempo: 66, warm: 0.75, minor: true },
    };
    const s = this.season >= 0 && this.season <= 3 ? this.season : 0;
    const c = Object.assign({ mode: 'planet', arp: 1.0, bass: 1.0, pad: 1.0, drone: 0.0 }, seasons[s]);
    // M3 — festival mood: +20% tempo, brighter, and a melody layer on top
    if (this.mood === 'festival') { c.tempo *= 1.2; c.warm *= 1.15; c.arp *= 1.2; c.melody = 1.0; }
    if (this.context === 'interior')    { c.mode = 'interior'; c.arp *= 0.65; c.pad *= 1.0; c.warm *= 1.05; }
    else if (this.context === 'cutscene') { c.mode = 'cutscene'; c.arp *= 0.8; c.pad *= 1.1; }
    else if (this.context === 'intro' || this.context === 'ship') { c.mode = 'space'; c.tempo *= 0.85; }
    if (this.activity === 'fishing') { c.mode = 'fishing'; c.arp *= 0.6; c.bass *= 0.6; c.drone = 0.0; }
    else if (this.activity === 'mining') { c.mode = 'mining'; c.arp *= 1.25; c.bass *= 1.2; c.drone = 0.5; }
    return c;
  }

  // Lookahead scheduler: schedule the next bar now so nothing ever gaps.
  tick() {
    if (!this.ctx || !this.master) return;
    const cfg = this.config();
    const ahead = this.ctx.currentTime + 0.4;
    while (this.nextBar < ahead) {
      this.scheduleBar(cfg, this.nextBar);
      this.nextBar += (60 / cfg.tempo) * 4; // one 4/4 bar
    }
  }

  // ── synthesis helpers ──────────────────────────────────────────────────

  // Note name (e.g. 'C4', 'Am3') -> frequency in Hz. Digits at the END are the
  // octave; letters before them are the pitch class (may include '#' or 'm').
  noteToFreq(note) {
    const mD = note.match(/\d+$/);
    const oct = mD ? parseInt(mD[0], 10) : 4;
    const nm = note.replace(/\d+$/g, '');
    const semi = SEMIS[nm] || 0;
    const m = semi + (oct - 4) * 12;          // semitones from C4
    return 440 * Math.pow(2, (m - 9) / 12);   // A4 = 440Hz
  }

  // Third of a chord root: minor if the chord name contains 'm'.
  thirdOf(rootNote) {
    const minor = /m/.test(rootNote.replace(/[0-9]/g, ''));
    const semi = minor ? 3 : 4;   // minor third or major third
    return this.noteToFreq(rootNote) * Math.pow(2, semi / 12);
  }

  // Schedule a single synthesized voice: osc -> [lowpass] -> env -> master.
  tone(freq, when, dur, gain, type, fc) {
    if (!this.ctx) return;
    const t0 = Math.max(when, this.ctx.currentTime);
    const osc = this.ctx.createOscillator();
    osc.type = type || 'sine';
    osc.frequency.setValueAtTime(freq, t0);
    // envelope gain (soft attack / decay so notes don't click)
    const env = this.ctx.createGain();
    const end = t0 + dur;
    env.gain.setValueAtTime(0.0001, t0);
    env.gain.linearRampToValueAtTime(gain, t0 + 0.08);
    env.gain.setValueAtTime(gain, end - 0.4 > t0 ? end - 0.4 : t0 + 0.15);
    env.gain.linearRampToValueAtTime(0.0001, end);
    let out = osc;
    if (fc) {
      const f = this.ctx.createBiquadFilter();
      f.type = 'lowpass';
      f.frequency.value = fc;
      osc.connect(f);
      out = f;
    }
    out.connect(env);
    env.connect(this.master);
    osc.start(t0);
    osc.stop(end);
    // release oscillator reference a touch later so GC doesn't cut it early
    osc.onended = () => { try { env.disconnect(); } catch (e) {} };
  }

  // Schedule one bar of chord-appropriate voices.
  scheduleBar(cfg, t) {
    const rootName = cfg.chords[this.barIndex % cfg.chords.length];
    this.barIndex++;
    const root = this.noteToFreq(rootName);
    const third = this.thirdOf(rootName);
    const fifth = root * 1.5;
    const step = (60 / cfg.tempo) * 0.5;   // eighth-note grid
    const barLen = (60 / cfg.tempo) * 4;

    // pad (detuned saws at low volume, lowpassed) - chord holds a bar
    const padGain = 0.05 * cfg.pad;
    this.tone(root, t, barLen, padGain, 'sawtooth', 900 * cfg.warm);
    this.tone(third, t, barLen, padGain * 0.8, 'sawtooth', 900 * cfg.warm);
    this.tone(fifth, t, barLen, padGain * 0.7, 'sawtooth', 900 * cfg.warm);
    // bass root pulse on beats 1 & 3
    const bassGain = 0.08 * cfg.bass;
    this.tone(root / 2, t, 0.5, bassGain, 'sine', 300);
    this.tone(root / 2, t + barLen / 2, 0.5, bassGain, 'sine', 300);
    // arpeggio: root-3-5-octave walking up the bar
    const arp = [root, third, fifth, root * 2];
    const arpGain = 0.06 * cfg.arp;
    for (let i = 0; i < arp.length; i++) {
      const when = t + i * step * (cfg.mode === 'interior' ? 4 : 2);
      if (when < t + barLen) {
        this.tone(arp[i], when, step * 1.4, arpGain, 'triangle', 1200);
      }
    }
    // mining: low sub drone for weight
    if (cfg.drone > 0) { this.tone(root / 4, t, barLen, 0.05 * cfg.drone, 'sine', 160); }
    // M3 — festival melody layer: a light, skipping counter-melody (square,
    // lowpassed) that plays over the pad only while the mood is festival.
    if (cfg.melody) {
      const scale = [0, 2, 4, 7, 9];            // major pentatonic
      const mstep = (60 / cfg.tempo) * 0.25;    // 16th grid
      for (let i = 0; i < 8; i++) {
        if (Math.random() < 0.28) continue;     // skip some 16ths for bounce
        const deg = scale[Math.floor(Math.random() * scale.length)];
        const f = root * 2 * Math.pow(2, deg / 12);
        this.tone(f, t + i * mstep, mstep * 1.6, 0.022 * cfg.melody, 'square', 2200);
      }
    }
  }

  dispose() {
    if (this.timer) clearInterval(this.timer);
    if (this.ctx) this.ctx.close();
    this.ctx = null; this.master = null; this.timer = null;
  }
}

export { MusicDirector };
