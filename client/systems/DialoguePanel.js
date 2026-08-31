// DialoguePanel.js — shared JRPG dialogue box for Space Farmer.
//
// One component backs the dialogue in every scene (PlanetScene's EarthBound
// NPC talk + SpaceshipScene's C.O.R.A. tutorial) so the scroll/clip/collapse
// logic lives in exactly one place instead of being duplicated per scene.
//
// Capabilities:
//   • clips the body text to the box interior (text never spills past the box)
//   • scrollable — when a line is taller than the box, ▲/▼ appear; mouse wheel
//     or tapping them scrolls within the box
//   • collapsible — a ▾ toggle minimises the box to a stub ("expand"); tap the
//     box to expand it back (peek past the narration)
//   • optional typewriter reveal, title, footer, portrait and speech tail
//
// Scenes own their input handling; the panel just owns the visuals + state.

const COLLAPSE_GLYPH = '▾';
const EXPAND_GLYPH = '▴';

export class DialoguePanel {
  constructor(scene, opts = {}) {
    this.scene = scene;
    const { width, height } = scene.game.config;
    const bw = opts.width ?? Math.round(width * 0.7);
    const bh = opts.height ?? 158;
    const cx = opts.x ?? width / 2;
    const cy = opts.y ?? height - 92;

    const boxL = cx - bw / 2, boxT = cy - bh / 2, boxR = cx + bw / 2, boxB = cy + bh / 2;
    this.boxL = boxL; this.boxT = boxT; this.boxR = boxR; this.boxB = boxB;
    this.cx = cx; this.bw = bw; this.bh = bh;

    // ── the panel ──
    this.box = scene.add.rectangle(cx, cy, bw, bh, 0x0a0a18, 0.95)
      .setStrokeStyle(3, 0x39c5bb).setDepth(1000)
      .setInteractive({ useHandCursor: true }).setVisible(false);
    // Tapping the box collapses/expands it — the reliable touch path to peek
    // past the narration. It listens on the scene input manager (fires on plain
    // canvas taps even when a Phaser hit-area slips on touch devices), so
    // collapsing works on mobile too — not just the tiny ▾ in the corner.
    scene.input.on('pointerdown', (pointer, over) => {
      if (!this.visible || !this.box.visible) return;
      // Scroll arrows keep scrolling; everything else in the box (incl. the
      // ▾/▴ corner glyph) toggles collapse. Scene-level input fires on plain
      // canvas taps even where small in-canvas hit-areas slip on touch devices.
      if ((over || []).some(o => o === this.scrollUp || o === this.scrollDown)) return;
      const inside = pointer.x >= this.boxL && pointer.x <= this.boxR &&
                     pointer.y >= this.boxT && pointer.y <= this.boxB;
      if (inside) { if (this.collapsed) this.expand(); else this.collapse(); }
    });

    // ── optional speech tail (EarthBound triangle toward the speaker) ──
    this.tail = null;
    if (opts.tail) {
      const tx = opts.tail.x != null ? opts.tail.x : cx;
      const ty = opts.tail.y != null ? opts.tail.y : boxT;
      this.tail = scene.add.triangle(tx, ty, -15, 7, 15, 7, 0, -9, 0x0a0a18)
        .setStrokeStyle(1, 0x39c5bb).setDepth(999).setVisible(false);
    }

    // ── optional portrait (upper-left) ──
    this.portraitPlate = null; this.portrait = null;
    if (opts.portrait) {
      const ppx = boxL + 21, ppy = boxT + 58;
      this.portraitBaseY = ppy;
      this.portraitPlate = scene.add.rectangle(ppx, ppy, 46, 52, 0x141426, 1)
        .setStrokeStyle(2, 0x39c5bb).setDepth(1001).setVisible(false);
      this.portrait = scene.add.image(ppx, ppy, opts.portrait.texture || 'port.nova_0')
        .setDepth(1002).setVisible(false);
    }

    // ── title (name plate / header) ──
    const titleX = opts.titleX ?? (opts.portrait ? boxL + 54 : boxL + 20);
    this.title = scene.add.text(titleX, boxT + 15, '', {
      fontFamily: "system-ui, 'Segoe UI', 'Trebuchet MS', sans-serif", fontSize: '11px', color: '#39c5bb',
      stroke: '#000', strokeThickness: 3,
    }).setOrigin(0, 0.5).setDepth(1001).setVisible(false);

    // ── body text: clipped to the box so it never overflows ──
    const textX = opts.textX ?? boxL + 20;
    const textTopY = opts.textTopY ?? boxT + 46;
    const wrapW = opts.wrapWidth ?? (bw - 48);
    this.text = scene.add.text(textX, textTopY, '', {
      fontFamily: "system-ui, 'Segoe UI', 'Trebuchet MS', sans-serif",
      fontSize: opts.fontSize || '12px', color: '#e8ecff',
      wordWrap: { width: wrapW }, lineSpacing: 6, align: 'left',
    }).setOrigin(0, 0).setDepth(1001).setVisible(false);

    const cTop = opts.clipTop ?? (boxT + 26);
    const cH = opts.clipHeight ?? (bh - 40);
    this._clip = scene.add.rectangle(cx, cTop + cH / 2, bw - 24, cH, 0x000000).setVisible(false).setDepth(1000);
    this.text.setMask(this._clip.createGeometryMask());
    this._textTop = textTopY; this._contentH = cH;

    // ── scroll indicators (▲▼) — shown only when the line overflows ──
    this.scrollUp = scene.add.text(boxR - 13, boxT + 42, '▲', {
      fontFamily: "system-ui, sans-serif", fontSize: '11px', color: '#9fffe0',
    }).setOrigin(0.5).setDepth(1003).setInteractive({ useHandCursor: true }).setVisible(false);
    this.scrollUp.on('pointerdown', () => this.scrollBy(-42));
    this.scrollDown = scene.add.text(boxR - 13, boxB - 28, '▼', {
      fontFamily: "system-ui, sans-serif", fontSize: '11px', color: '#9fffe0',
    }).setOrigin(0.5).setDepth(1003).setInteractive({ useHandCursor: true }).setVisible(false);
    this.scrollDown.on('pointerdown', () => this.scrollBy(42));

    // ── collapse toggle (▾) in the top-right corner ──
    this.collapseBtn = scene.add.text(boxR - 12, boxT + 13, COLLAPSE_GLYPH, {
      fontFamily: "system-ui, sans-serif", fontSize: '12px', color: '#9fffe0',
    }).setOrigin(1, 0.5).setDepth(1003).setInteractive({ useHandCursor: true }).setVisible(false);

    // ── footer hint (prompt / gift keys) ──
    this.hint = scene.add.text(boxR - 4, boxB - 14, '', {
      fontFamily: "system-ui, 'Segoe UI', 'Trebuchet MS', sans-serif", fontSize: '9px', color: '#8a90b0',
    }).setOrigin(1, 0.5).setDepth(1001).setVisible(false);

    // ── state ──
    this.scroll = 0; this.maxScroll = 0; this.scrollable = false;
    this.collapsed = false;
    this.visible = false;
    this.homeY = textTopY;
    this._type = null;            // typewriter TimerEvent ref
    this._onDone = null;
    this._footer = '';
    this._fullTextCache = '';

    // mouse wheel scrolls the dialogue text on desktop (bound once)
    this._wheelBound = false;
    scene.input.on('wheel', (pointer, objs, dx, dy) => {
      if (this.visible && this.scrollable && !this.collapsed) this.scrollBy(dy * 8);
    });
    this._wheelBound = true;

    // Screen-fixed, like the DOM touch controls: the whole dialogue stays glued
    // to the viewport instead of sliding around with the scrolling camera.
    [this.box, this.tail, this.portraitPlate, this.portrait, this.title,
     this.text, this._clip, this.scrollUp, this.scrollDown, this.collapseBtn, this.hint]
      .forEach(o => { if (o) o.setScrollFactor(0); });
  }

  // ── public text API ────────────────────────────────────────────────
  /** Set (and optionally type out) the body text. */
  setText(text, { title, footer, typewriter = false, onDone } = {}) {
    this.visible = true;
    this.collapsed = false;
    this.scroll = 0;
    this.collapseBtn.setText(COLLAPSE_GLYPH);
    this._footer = footer || '';
    this._onDone = onDone || null;
    this._stopType();
    this.text.setVisible(true);
    this.title.setVisible(true);
    if (this.portrait) { this.portrait.setVisible(true); if (this.portraitPlate) this.portraitPlate.setVisible(true); }
    if (title !== undefined) this.title.setText(title);
    if (footer !== undefined) this.hint.setText(footer).setColor('#8a90b0').setVisible(true);
    else this.hint.setVisible(false);
    this.collapseBtn.setVisible(true);

    if (typewriter) {
      this._fullTextCache = text;
      this._typeOut(text);
    } else {
      this.text.setText(text);
      this._updateScroll();
    }
    this.box.setVisible(true);
    if (this.tail) this.tail.setVisible(true);
  }

  /** Show the existing box (e.g. for a new line in a queued array). */
  show() {
    this.visible = true;
    this.box.setVisible(true);
    if (this.tail) this.tail.setVisible(true);
    if (this.portrait) { this.portrait.setVisible(true); if (this.portraitPlate) this.portraitPlate.setVisible(true); }
    this.text.setVisible(!this.collapsed);
    this.title.setVisible(!this.collapsed);
  }

  /** Hide and fully reset the panel. */
  hide() {
    this.visible = false;
    this._stopType();
    this.box.setVisible(false);
    this.title.setVisible(false);
    this.text.setVisible(false);
    if (this.hint) this.hint.setVisible(false);
    if (this.portrait) { this.portrait.setVisible(false); if (this.portraitPlate) this.portraitPlate.setVisible(false); }
    if (this.tail) this.tail.setVisible(false);
    this.scrollUp.setVisible(false); this.scrollDown.setVisible(false);
    if (this.collapseBtn) this.collapseBtn.setVisible(false);
    this.scroll = 0; this.collapsed = false;
  }

  _typeOut(full) {
    const P = this;
    let shown = 0;
    const step = () => {
      shown = Math.min(full.length, shown + 2);
      P.text.setText(full.slice(0, shown));
      P._updateScroll();
      if (shown >= full.length) {
        if (P._footer) P.hint.setVisible(true);
        if (P._onDone) P._onDone();
      } else {
        P._type = P.scene.time.delayedCall(28, step);
      }
    };
    step();
  }

  /** Instantly finish any in-progress typewriter reveal. */
  finishTyping() {
    this._stopType();
    this.text.setText(this._fullTextCache);
    this._updateScroll();
    if (this._footer) this.hint.setVisible(true);
  }

  _stopType() {
    if (this._type) { this._type.remove(); this._type = null; }
  }

  // ── scroll ────────────────────────────────────────────────────────
  _updateScroll() {
    const th = this.text.height || 0;
    this.maxScroll = Math.max(0, th - this._contentH);
    this.scrollable = this.maxScroll > 0;
    this.scroll = Math.min(this.scroll, this.maxScroll);
    this.text.y = this.homeY - this.scroll;
    const show = this.scrollable && !this.collapsed && this.visible;
    this.scrollUp.setVisible(show && this.scroll > 0);
    this.scrollDown.setVisible(show && this.scroll < this.maxScroll);
  }

  scrollBy(delta) {
    if (!this.scrollable) return;
    this.scroll = Phaser.Math.Clamp(this.scroll + delta, 0, this.maxScroll);
    this._updateScroll();
  }

  // ── collapse / expand ─────────────────────────────────────────────
  toggleCollapse() { this.collapsed ? this.expand() : this.collapse(); }

  collapse() {
    if (this.collapsed) return;
    this.collapsed = true;
    this.text.setVisible(false);
    this.title.setVisible(false);
    if (this.portrait) { this.portrait.setVisible(false); if (this.portraitPlate) this.portraitPlate.setVisible(false); }
    this.scrollUp.setVisible(false); this.scrollDown.setVisible(false);
    this.collapseBtn.setText(EXPAND_GLYPH);
    this.hint.setText('expand').setColor('#6ee7d0').setVisible(true);
  }

  expand() {
    if (!this.collapsed) return;
    this.collapsed = false;
    this.text.setVisible(true);
    this.title.setVisible(true);
    if (this.portrait) { this.portrait.setVisible(true); if (this.portraitPlate) this.portraitPlate.setVisible(true); }
    this.hint.setText(this._footer || '').setColor('#8a90b0').setVisible(!!this._footer);
    this.collapseBtn.setText(COLLAPSE_GLYPH);
    this._updateScroll();
  }

  // ── portrait texture swap (PlanetScene animated mouths / bobbing) ─
  setPortrait(texture) {
    if (this.portrait && this.portrait.texture.key !== texture) this.portrait.setTexture(texture);
  }
}

export default DialoguePanel;
