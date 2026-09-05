// ColonyHub.js — the colony's ONE menu.
//
// A single Phaser panel that holds every activity the colony offers. It is
// opened by ONE code path from BOTH inputs — desktop presses M, mobile taps
// the MENU button in the touch bar — so keyboard and touch players drive the
// exact same interface. Plug-and-play: the scene registers sections
// ({ id, label, hint, run }) and the hub renders them as rows that are
// simultaneously keyboard-navigable (number keys 1-9, arrow keys, SPACE to
// confirm) and touch-tap targets (shown on iPhones under the canvas).
//
// The hub never owns game logic; it only routes to the scene's existing
// methods (openShop, openRanch, fish, mine, …). Sections are data, not code.

export class ColonyHub {
  constructor(scene) {
    this.scene = scene;
    this.sections = [];      // [{ id, label, hint, run }]
    this.sel = 0;            // keyboard-selected row index
    this.open = false;
    this.panel = null;       // Phaser container
    this.rows = [];          // [{ rect, labelText, hintText, section }]
    this._built = false;
  }

  /**
   * Create the panel (once, from the scene). Call in the scene's create().
   * Sized to the actual viewport so it never clips on a phone screen.
   */
  build() {
    if (this._built) return this;
    const scene = this.scene;
    const { width, height } = scene.game.config;
    const panelW = Math.min(620, width - 24);
    const panelH = Math.min(Math.round(height * 0.86), 620);
    const panel = scene.add.container(width / 2, height / 2).setDepth(1010).setScrollFactor(0).setVisible(false);
    const bg = scene.add.rectangle(0, 0, panelW, panelH, 0x070714, 0.96).setStrokeStyle(3, 0x67e1cd);
    const title = scene.add.text(0, -panelH / 2 + 24, 'COLONY HUB', {
      fontFamily: "system-ui, 'Segoe UI', 'Trebuchet MS', sans-serif",
      fontSize: '16px', color: '#9dffec', fontStyle: 'bold',
    }).setOrigin(0.5);
    const sub = scene.add.text(0, -panelH / 2 + 44, 'one menu, every activity — keys 1-9 / arrows / tap a row', {
      fontFamily: "system-ui, 'Segoe UI', sans-serif", fontSize: '9px', color: '#7fb8ae',
    }).setOrigin(0.5);
    const footer = scene.add.text(0, panelH / 2 - 22, '[ESC / B] close', {
      fontFamily: "system-ui, 'Segoe UI', sans-serif", fontSize: '9px', color: '#8a90b0',
    }).setOrigin(0.5);
    panel.add([bg, title, sub, footer]);
    this.panel = panel;
    this.bg = bg; this.title = title; this.sub = sub; this.footer = footer;
    this._built = true;
    return this;
  }

  /** Register the menu's rows (data, not UI). Re-renders immediately. */
  setSections(list) {
    this.sections = (list || []).slice();
    this.sel = 0;
    this._render();
  }

  toggle() {
    if (this.open) this.close();
    else this.openPanel();
  }

  openPanel() {
    const scene = this.scene;
    // single-panel rule: open the hub on top of a closed desk
    if (typeof scene.closeAllPanels === 'function') scene.closeAllPanels('hub');
    this.open = true;
    if (this.panel) this.panel.setVisible(true);
    if (this._built) {
      this.panel.setAlpha(0);
      scene.tweens.add({ targets: this.panel, alpha: 1, duration: 160 });
    }
    this.sel = 0;
    this._render();
    if (typeof scene._hubOpened === 'function') scene._hubOpened();
  }

  close() {
    this.open = false;
    if (this.panel) this.panel.setVisible(false);
  }

  /** Keyboard navigation. */
  move(dir) {
    if (!this.sections.length) return;
    const n = this.sections.length;
    this.sel = (this.sel + dir + n) % n;
    this._render();
  }

  /** Confirm the selected row (SPACE/ENTER/E or a tap). */
  confirm(index) {
    const s = this.sections[index] || this.sections[this.sel];
    if (!s) return;
    // switching to a panel = close the hub and run the action.
    if (typeof this.scene.closeAllPanels === 'function') this.scene.closeAllPanels();
    this.close();
    if (s.run) s.run();
  }

  /** Rebuild the row visuals from this.sections. Cheap enough to call per frame. */
  _render() {
    if (!this._built) return;
    const scene = this.scene;
    // destroy any stale rows (rect + label + hint each)
    for (const r of this.rows) {
      r.rect.destroy(); r.labelText.destroy();
      if (r.hintText) r.hintText.destroy();
    }
    this.rows = [];
    const { height } = scene.game.config;
    const top = -this.bg.height / 2 + 60;
    const bottom = this.bg.height / 2 - 24;
    const span = bottom - top;
    const rowH = Math.max(26, Math.min(58, span / Math.max(this.sections.length, 1)));
    const gap = rowH;
    this.sections.forEach((s, i) => {
      const y = top + rowH / 2 + i * gap;
      const fill = i === this.sel ? 0x244154 : 0x132432;
      const rect = scene.add.rectangle(0, y, this.bg.width - 48, rowH - 10, fill, 0.98)
        .setStrokeStyle(i === this.sel ? 1.6 : 1, i === this.sel ? 0x67e1cd : 0x2a4650)
        .setInteractive({ useHandCursor: true });
      const num = i < 9 ? '[' + (i + 1) + '] ' : '';
      const labelText = scene.add.text(-this.bg.width / 2 + 34, y, num + s.label, {
        fontFamily: "system-ui, 'Segoe UI', sans-serif", fontSize: '13px',
        color: i === this.sel ? '#9dffec' : '#e8ecff', fontStyle: 'bold',
      }).setOrigin(0, 0.5);
      const hintText = scene.add.text(this.bg.width / 2 - 34, y, s.hint || '', {
        fontFamily: "system-ui, 'Segoe UI', sans-serif", fontSize: '10px', color: '#8fb8ae',
      }).setOrigin(1, 0.5);
      rect.on('pointerdown', () => this.confirm(i));
      rect.on('pointerover', () => rect.setFillStyle(0x244154, 1));
      rect.on('pointerout', () => rect.setFillStyle(i === this.sel ? 0x244154 : 0x132432, 0.98));
      this.panel.add([rect, labelText, hintText]);
      this.rows.push({ rect, labelText, hintText, section: s });
    });
  }
}
