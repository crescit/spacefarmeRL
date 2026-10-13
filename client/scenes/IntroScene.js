// IntroScene.js — Cinematic intro crawl
// Year 2987, Earth is a dustball, Galactic Farm Initiative
// 2000s 8-bit pixel art starfield backdrop

import { AudioSystem } from '../systems/AudioSystem.js';
import { TouchControls } from '../systems/TouchControls.js';
import { story } from '../systems/StoryService.js';
import { tex } from '../systems/AssetTheme.js';

// The opening crawl and title-card copy live in the StoryBank
// (shared/story/intro.js) — the ONLY source for these words. We render
// story.intro.* here so the browser, docs, and tooling can never drift.
const INTRO_TEXT = story.intro.crawl;

class IntroScene extends Phaser.Scene {
  constructor() {
    super({ key: 'IntroScene' });
  }

  preload() {
    AudioSystem.preload(this);
    // ART-05: painted title key art (Qwen Image 2.1 on the Mac, pixelized to a
    // 480x270 / 160-colour plate so it sits in the game's pixel language).
    this.load.image('art.title_keyart', 'client/art/title_keyart.png');
    this.load.image('art.crawl_shipbay', 'client/art/crawl_shipbay.png');
  }

  create() {
    const { width, height } = this.game.config;

    // ── Touch controls: present on every screen (Intro included) ──
    this.touchCtrl = new TouchControls(this);
    this.touchCtrl.build();

    // SF03: gameplay keys (Colony Hub / Shop / Upgrades) mean nothing during
    // the crawl — hide the hint strip below the canvas until gameplay starts.
    // The shutdown hook restores it when Spaceship/Planet take over.
    this.touchCtrl.hideInfo();
    this.events.on('shutdown', () => this.touchCtrl.showInfo());

    // ── Backdrop: nebula + planet + twinkling stars ──
    // QA 0904B.4: a single tileSprite shows the SAME blob cluster 3×3 → the
    // opening frame reads as wallpaper. Two layers now cross-fade (0.6/0.4)
    // at different tile scales so the blob pattern never repeats visibly,
    // each with its own drift vector, plus five single cloud sprites at
    // hand-picked positions to break the grid outright.
    this.nebula = this.add.tileSprite(width / 2, height / 2, width, height, tex('fx.nebula'));
    this.nebula2 = this.add.tileSprite(width / 2, height / 2, width, height, tex('fx.nebula'))
      .setAlpha(0.4).setTileScale(2.6);
    // hand-picked cloud placements (positions chosen in the config viewport
    // — fixed, never random, so they read as deliberate compositing)
    const cloudSpec = [
      { x: width * 0.22, y: height * 0.16, scale: 1.9, alpha: 0.34, drift: 0.016 },
      { x: width * 0.78, y: height * 0.30, scale: 2.6, alpha: 0.28, drift: 0.010 },
      { x: width * 0.08, y: height * 0.62, scale: 2.2, alpha: 0.24, drift: 0.013 },
      { x: width * 0.55, y: height * 0.86, scale: 3.1, alpha: 0.22, drift: 0.009 },
      { x: width * 0.90, y: height * 0.72, scale: 1.6, alpha: 0.30, drift: 0.018 },
    ];
    this.nebulaClouds = cloudSpec.map((c) => ({
      ...c,
      img: this.add.image(c.x, c.y, tex('fx.nebula-cloud')).setScale(c.scale).setAlpha(c.alpha),
    }));
    // ART-05: during the crawl we are aboard the ship — the hydroponics bay
    // painting sits behind the stars, dimmed so the crawl stays the subject.
    if (this.textures.exists('art.crawl_shipbay')) {
      const t = this.textures.get('art.crawl_shipbay');
      t.setFilter(Phaser.Textures.FilterMode.NEAREST);
      const src = t.getSourceImage();
      const k = Math.max(width / src.width, height / src.height);
      this.shipArt = this.add.image(width / 2, height / 2, 'art.crawl_shipbay').setScale(k).setAlpha(0.55);
      this.tweens.add({ targets: this.shipArt, scale: k * 1.05, duration: 30000, ease: 'Sine.easeInOut', yoyo: true, repeat: -1 });
    }
    this.planet = this.add.image(width - 170, height - 190, tex('fx.planet'));
    this.planet2 = this.add.image(120, 150, tex('fx.planet')).setScale(0.55).setAlpha(0.6).setFlipX(true);

    // QA 0904 8.4: one flat star dusting read as soft speckle over the nebula.
    // The field is now THREE parallax layers — far dust (tiny, slow), a mid
    // band, and near pinwheels (big, fast) — each its own graphics object so
    // the update() drift gives real depth, plus a denser band streak that
    // reads as the galaxy's plane, not random noise.
    this.starLayers = [
      { n: 140, sizeMax: 1, alphaMax: 0.5, speed: 0.012, gfx: this.add.graphics() },
      { n: 90, sizeMax: 2, alphaMax: 0.75, speed: 0.028, gfx: this.add.graphics() },
      { n: 46, sizeMax: 3, alphaMax: 1.0, speed: 0.055, gfx: this.add.graphics() },
    ];
    this.stars = [];
    this.starLayers.forEach((L, li) => {
      for (let i = 0; i < L.n; i++) {
        // the mid layer concentrates a denser galactic band across the upper
        // third so the backdrop has a readable plane, not uniform confetti
        const bandy = li === 1 && Math.random() < 0.55
          ? height * 0.14 + Math.random() * height * 0.26
          : Math.random() * height;
        this.stars.push({
          layer: li,
          x: Math.random() * width,
          y: bandy,
          size: Math.floor(Math.random() * L.sizeMax) + 1,
          alpha: Math.random() * L.alphaMax * 0.6 + L.alphaMax * 0.4,
          twinkleSpeed: Math.random() * 0.03 + 0.01,
          phase: Math.random() * Math.PI * 2,
        });
      }
    });
    this.drawStarfield();

    // ── Cinematic depth: CRT scanlines + soft vignette + homeworld in the void
    this.vignette = this.add.tileSprite(width / 2, height / 2, width, height, tex('fx.vignette'))
      .setDepth(950).setAlpha(0.7);
    this.asteroid = this.add.image(width - 210, height - 150, tex('fx.asteroid'))
      .setDepth(940).setScale(0.85).setAlpha(0.9);
    // the guide droid (BEEP) drifts across the void as a cameo — a thread from
    // the crawl into the tutorial, so the ship's little guide is never a stranger
    this.introDroid = this.add.image(120, 300, tex('ship.droid')).setDepth(945).setScale(1.3).setAlpha(0.9);

    // ART-05: with the ship-bay painting up we are INSIDE the ship — free-floating
    // procedural planets/asteroid/droid read as stickers on the wall, so they go.
    if (this.shipArt) {
      [this.planet, this.planet2, this.asteroid, this.introDroid, this.nebula, this.nebula2, ...this.nebulaClouds.map((c) => c.img)]
        .forEach((o) => o && o.setVisible(false));
      this.starLayers.forEach((L) => L.gfx.setAlpha(0.35));
    }

    // ── Title card (hidden until the crawl finishes) ──
    this.titleCard = this.add.container(width / 2, height / 2).setVisible(false);
    const orbit = this.titleOrbit = this.add.graphics();
    orbit.lineStyle(1, 0x67e1cd, 0.28).strokeEllipse(0, -116, 310, 102);
    orbit.lineStyle(2, 0xf2bd68, 0.5).beginPath().arc(0, -116, 155, 2.8, 4.7).strokePath();
    const titlePlate = this.add.rectangle(0, 36, Math.min(620, width * 0.78), 190, 0x071a20, 0.8)
      .setStrokeStyle(1, 0x67e1cd, 0.5);
    this.houseImg = this.add.image(0, -150, tex('bld.house')).setScale(2.2);
    this.houseGlow = this.add.image(0, -120, tex('bld.houseGlow')).setBlendMode(Phaser.BlendModes.ADD).setScale(2.2).setAlpha(0.8);
    // QA 0904 8.2 legibility: the eyebrow/subtitle at 10/13px over the busy
    // starfield washed out. Both stepped up a size, got a firmer stroke, and
    // the plate they sit on went more opaque — small glyph copy has to survive
    // a bright backdrop, not ask permission from it.
    const eyebrow = this.add.text(0, -28, story.intro.eyebrow, {
      fontFamily: "system-ui, 'Segoe UI', sans-serif", fontSize: '12px', fontStyle: 'bold', color: '#9fd9cd',
      stroke: '#04161b', strokeThickness: 4,
    }).setOrigin(0.5);
    this.titleText = this.add.text(0, 22, story.intro.title, {
      fontFamily: "system-ui, 'Segoe UI', 'Trebuchet MS', sans-serif", fontSize: '48px', fontStyle: 'bold', color: '#f7d698',
      stroke: '#3b2915', strokeThickness: 5, shadow: { color: '#f2bd68', blur: 20, offset: 0, fill: true },
    }).setOrigin(0.5);
    const rule = this.add.rectangle(0, 66, 190, 2, 0x67e1cd, 0.7);
    this.subtitle = this.add.text(0, 89, story.intro.subtitle, {
      fontFamily: "system-ui, 'Segoe UI', sans-serif", fontSize: '15px', color: '#dcf3ec',
      stroke: '#041115', strokeThickness: 4,
    }).setOrigin(0.5);
    this.pressStart = this.add.text(0, 142, story.intro.pressStart, {
      fontFamily: "system-ui, 'Segoe UI', sans-serif", fontSize: '11px', fontStyle: 'bold', color: '#f7d698',
      stroke: '#061116', strokeThickness: 3,
    }).setOrigin(0.5);
    // SF17: returning player sees a CONTINUE hint next to the press-start blink
    this.continueHint = this.add.text(0, 176, 'CONTINUE — SPACE   NEW RUN — N', {
      fontFamily: "system-ui, 'Segoe UI', sans-serif", fontSize: '11px', fontStyle: 'bold', color: '#9fd9cd',
      stroke: '#061116', strokeThickness: 3,
    }).setOrigin(0.5).setVisible(this.landed);
    this.titleCard.add([orbit, titlePlate, this.houseImg, this.houseGlow, eyebrow, this.titleText, rule, this.subtitle, this.pressStart, this.continueHint]);

    // ── Text crawl (big, bright, on a dark panel for legibility) ──
    // Sliding window: only the last few lines stay on screen, so a long story
    // reads like a crawl instead of overflowing the panel.
    this.line = 0;
    this.charIndex = 0;
    this.shownLines = [];
    this.currentLine = '';
    this.titleShown = false;
    this.crawlWindow = 7;
    const crawlStyle = {
      fontFamily: "system-ui, 'Segoe UI', 'Trebuchet MS', sans-serif",
      fontSize: '20px',
      color: '#eafff0',
      align: 'center',
      lineSpacing: 12,
      stroke: '#000000',
      strokeThickness: 3,
    };
    // SF13: the slab used to be a fixed 300px slate — taller than the text it
    // holds, and the droid cameo sailed straight through it. The panel height
    // is now DERIVED from the crawl text bounds (longest line × the window,
    // measured with the exact style the crawl uses) + 28px padding.
    const sampleText = Array.from({ length: this.crawlWindow }, () => INTRO_TEXT.reduce((a, b) => (b.length > a.length ? b : a), '')).join('\n');
    const sampler = this.add.text(width / 2, height * 0.42, sampleText, crawlStyle).setVisible(false);
    const panelH = Math.round(sampler.height) + 28;
    sampler.destroy();
    const panelW = Math.min(Math.round(width * 0.8), 680);
    const panelY = height * 0.42;
    // subtle vertical gradient: two stacked rects, darker crown over a base
    const crownH = Math.round(panelH * 0.55);
    const crawlPanelTop = this.add.rectangle(width / 2, panelY - panelH / 2 + crownH / 2, panelW, crownH, 0x141c2e, 0.88)
      .setStrokeStyle(1, 0x39c5bb, 0.75);
    const crawlPanelBase = this.add.rectangle(width / 2, panelY + panelH / 2 - (panelH - crownH) / 2, panelW, panelH - crownH, 0x232e43, 0.88)
      .setStrokeStyle(1, 0x39c5bb, 0.75);
    const brackets = this.add.graphics();
    brackets.lineStyle(2, 0x67e1cd, 0.85);
    this._drawCrawlBrackets(brackets, width / 2 - panelW / 2, panelY - panelH / 2, width / 2 + panelW / 2, panelY + panelH / 2);
    // dark backing panel so the crawl reads cleanly over the busy starfield
    this.crawlPanel = this.add.container(0, 0).add([crawlPanelTop, crawlPanelBase, brackets]).setScrollFactor(0);
    // geometry the droid's drift path is bounds-checked against every frame
    this.crawlPanelRect = { left: width / 2 - panelW / 2, right: width / 2 + panelW / 2, top: panelY - panelH / 2, bottom: panelY + panelH / 2 };
    // SF13: pick the droid's OUTER lane — above the panel band if the cameo
    // started above its centre, below it otherwise — measured with a 22px
    // margin plus half the sprite size so its bounds can never intersect.
    const droidHalf = Math.round(this.introDroid.displayWidth / 2);
    const laneTop = this.crawlPanelRect.top - 22 - droidHalf;
    const laneBottom = this.crawlPanelRect.bottom + 22 + droidHalf;
    this.droidLane = this.introDroid.y <= panelY ? laneTop : laneBottom;
    this.textObject = this.add.text(width / 2, panelY, '', crawlStyle)
      .setOrigin(0.5).setScrollFactor(0);

    // input: skip crawl (SPACE / A) or begin (once title shown)
    // SF17: a returning player (sf_landed set by PlanetScene) gets a straight
    // CONTINUE path — SPACE jumps to the farm, N starts the tutorial anew.
    this.landed = false;
    try { this.landed = localStorage.getItem('sf_landed') === '1'; } catch {}
    this.input.keyboard.on('keydown', (e) => {
      // Browsers report the spacebar's `key` as ' ' (not 'Space'); check BOTH the
      // key and code so SPACE advances/skips the crawl on every engine. Only
      // 'a'/'A' (and the spacebar) advance — other letters are ignored.
      const isSpace = e.key === ' ' || e.key === 'Space' || e.code === 'Space';
      if (isSpace || e.key === 'a' || e.key === 'A') this.handleSpace();
      if (this.titleShown && this.landed && (e.key === 'n' || e.key === 'N')) this.startNewRun();
    });
    this.input.on('pointerdown', () => this.handleSpace());

    this.nextLine();

    // ── Audio: boot BGM + SFX on first input (autoplay policy) ──
    this.audio = new AudioSystem(this);
    const bootAudio = () => { this.audio.boot(); if (window.SpaceFarmer?.music) window.SpaceFarmer.music.setContext('intro'); };
    this._bootAudio = bootAudio;            // TouchControls reuses this for DOM-button gestures
    this.input.once('pointerdown', bootAudio);
    this.input.keyboard.once('keydown', bootAudio);
  }

  handleSpace() {
    if (this.titleShown) {
      // SF17: returning player → straight back to the farm. Credits come from
      // the server (stable player id restores the save); we pass NO credits
      // value so PlanetScene/network can't be seeded with a fake number.
      if (this.landed) { this.scene.start('PlanetScene'); return; }
      this.scene.start('SpaceshipScene');
      return;
    }
    // skip the crawl → go straight to title
    if (this.line < INTRO_TEXT.length) {
      this.line = INTRO_TEXT.length;
      this.showTitle();
    }
  }

  // Touch A button → same as SPACE (advance crawl / begin)
  handleInteract() {
    this.handleSpace();
  }

  // SF17: NEW RUN — N replays the ship tutorial (flag stays set; landing
  // again on the planet will re-set it when the tutorial completes).
  startNewRun() {
    this.scene.start('SpaceshipScene');
  }

  _renderCrawl() {
    if (this.titleShown || !this.textObject) return;   // crawl is gone (skipped/faded) — never touch it
    // Completed lines scroll through the window; the line being typed lives
    // ONLY as currentLine (not yet in shownLines), so it never renders twice.
    const comp = this.shownLines.slice(-(this.crawlWindow - 1));
    const lines = this.currentLine ? [...comp, this.currentLine] : comp;
    this.textObject.setText(lines.join('\n'));
  }

  nextLine() {
    if (this.line >= INTRO_TEXT.length) { this.showTitle(); return; }
    if (this.titleShown) return;            // crawl was skipped mid-roll
    this.currentLine = '';
    this.charIndex = 0;
    const full = INTRO_TEXT[this.line];
    this.line++;
    this._renderCrawl();
    this.typeNext(full);
  }

  typeNext(full) {
    if (this.titleShown) return;            // skip happened mid-type — stop cleanly
    if (this.charIndex >= full.length) {
      this.shownLines.push(full);           // line finished → it enters the scroll window
      this.currentLine = '';
      this._renderCrawl();
      this.time.delayedCall(1200, () => this.nextLine());
      return;
    }
    this.currentLine += full[this.charIndex];
    this.charIndex++;
    this._renderCrawl();
    this.time.delayedCall(40, () => this.typeNext(full));
  }

  showTitle() {
    if (this.titleShown) return;
    this.titleShown = true;
    // fade out the crawl (text + panel), fade in the title card
    this.tweens.add({
      targets: [this.textObject, this.crawlPanel],
      alpha: 0,
      duration: 600,
      onComplete: () => { this.textObject.destroy(); this.crawlPanel.destroy(); this.crawlPanelRect = null; },
    });
    // ART-05: the colony itself rises behind the title — cover-scaled, crisp
    // NEAREST pixels, with a soft dark band so the plate text stays readable.
    if (this.textures.exists('art.title_keyart')) {
      const { width, height } = this.game.config;
      const t = this.textures.get('art.title_keyart');
      t.setFilter(Phaser.Textures.FilterMode.NEAREST);
      const src = t.getSourceImage();
      const k = Math.max(width / src.width, height / src.height);
      this.keyArt = this.add.image(width / 2, height / 2, 'art.title_keyart')
        .setScale(k).setAlpha(0).setDepth(-5);
      this.tweens.add({ targets: this.keyArt, alpha: 1, duration: 1400, ease: 'Sine.easeOut' });
      // slow push-in so the frame breathes
      this.tweens.add({ targets: this.keyArt, scale: k * 1.06, duration: 24000, ease: 'Sine.easeInOut', yoyo: true, repeat: -1 });
      // the painting IS the colony now: drop the sticker house + orbit ring and
      // seat the plate in the lower third so the dome and gas giant stay clear
      [this.houseImg, this.houseGlow, this.titleOrbit].forEach((o) => o && o.setVisible(false));
      this.houseGlow = null;
      this.titleCard.y = height * 0.66;
      if (this.nebula) this.tweens.add({ targets: [this.shipArt, this.nebula, this.nebula2, this.planet, this.planet2, this.asteroid, this.introDroid, ...this.nebulaClouds.map((c) => c.img), ...this.starLayers.map((L) => L.gfx)].filter(Boolean), alpha: 0, duration: 1200 });
    }
    this.titleCard.setVisible(true);
    this.titleCard.setScale(0.9);
    this.tweens.add({
      targets: this.titleCard,
      scale: 1,
      duration: 700,
      ease: 'Quad.easeOut',
    });
    // the little dome house on the plate is ALIVE, not a sticker:
    // its window-glow breathes like a hearth and the house rocks a breath-scale
    if (this.houseGlow) {
      this.tweens.add({
        targets: this.houseGlow,
        alpha: [0.45, 0.95, 0.55],
        duration: 2600,
        ease: 'Sine.easeInOut',
        repeat: -1,
      });
      this.tweens.add({
        targets: this.houseImg,
        scale: { start: 2.14, to: 2.26, ease: 'Sine.easeInOut', duration: 2800, yoyo: true, repeat: -1 },
      });
    }
    // blink the press-start prompt
    this.tweens.add({
      targets: this.pressStart,
      alpha: 0.2,
      duration: 550,
      yoyo: true,
      repeat: -1,
    });
  }

  // SF13: colony-style corner bracket ticks framing the crawl panel —
  // four small L marks (14px arms, 6px inset) on the panel rect corners.
  _drawCrawlBrackets(gfx, left, top, right, bottom) {
    const inset = 6;
    const arm = 14;
    const corners = [
      [left - inset, top - inset, 1, 1],
      [right + inset, top - inset, -1, 1],
      [left - inset, bottom + inset, 1, -1],
      [right + inset, bottom + inset, -1, -1],
    ];
    for (const [cx, cy, sx, sy] of corners) {
      gfx.beginPath();
      gfx.moveTo(cx, cy);
      gfx.lineTo(cx + arm * sx, cy);
      gfx.moveTo(cx, cy);
      gfx.lineTo(cx, cy + arm * sy);
      gfx.strokePath();
    }
  }

  drawStarfield() {
    const { width, height } = this.game.config;
    for (const L of this.starLayers) L.gfx.clear();
    // (nebula tile sits behind these graphics objects — only draw stars)
    for (const s of this.stars) {
      const L = this.starLayers[s.layer];
      const twinkle = 0.3 + Math.abs(Math.sin(s.phase + s.twinkleSpeed * this.time.now)) * 0.7;
      const alpha = s.alpha * twinkle;
      const brightness = Math.floor(alpha * 255);
      const color = (brightness << 16) | (brightness << 8) | brightness;
      L.gfx.fillStyle(color, alpha);
      L.gfx.fillRect(s.x, s.y, s.size, s.size);
    }
  }

  update() {
    // gentle parallax drift on the backdrop — each star layer drifts at its
    // own rate (QA 0904 8.4: depth comes from the RELATIVE drift speeds)
    // gentle parallax drift on the backdrop — each layer drifts at its own
    // rate (QA 0904B.4: the two nebula sheets slide at different vectors so
    // the blob clusters shear apart instead of repeating as wallpaper)
    this.nebula.tilePositionX -= 0.02;
    this.nebula.tilePositionY -= 0.006;
    if (this.nebula2) {
      this.nebula2.tilePositionX -= 0.043;
      this.nebula2.tilePositionY += 0.011;
    }
    if (this.nebulaClouds) {
      const W = this.game.config.width;
      for (const c of this.nebulaClouds) {
        c.img.x -= c.drift;
        if (c.img.x < -320) c.img.x = W + 340; // wrap the drifting clouds
      }
    }
    if (this.starLayers) {
      for (const L of this.starLayers) {
        L.gfx.x -= L.speed;
        if (L.gfx.x < -this.game.config.width) L.gfx.x += this.game.config.width;
      }
    }
    if (this.planet) this.planet.y += Math.sin(this.time.now * 0.0003) * 0.05;
    // the asteroid slowly tumbles through the void (rotation + bob)
    if (this.asteroid) {
      this.asteroid.rotation = Math.sin(this.time.now * 0.00018) * 0.07;
      this.asteroid.y += Math.sin(this.time.now * 0.0004) * 0.06;
    }
    // the droid drifts slowly across the nebula, bobbing and swaying like a
    // little probe — a living detail BEHIND the crawl, never over its text:
    // SF13 bounds the drift lane against the panel rect (outer margins only).
    if (this.introDroid) {
      const { width } = this.game.config;
      const d = this.introDroid;
      d.x += 0.22;
      d.y = this.droidLane + Math.sin(this.time.now * 0.0008) * 9;
      d.rotation = Math.sin(this.time.now * 0.0005) * 0.16;
      if (d.x > width + 40) d.x = -40;
      // defensive bounds check: if the bob ever clips the panel band, the lane
      // is re-asserted (both lane values sit ≥22px + half-sprite outside it)
      if (this.crawlPanelRect) {
        const pb = this.crawlPanelRect;
        const halfD = Math.round(d.displayWidth / 2);
        const db = { left: d.x - halfD, right: d.x + halfD, top: d.y - halfD, bottom: d.y + halfD };
        if (db.right > pb.left && db.left < pb.right && db.bottom > pb.top && db.top < pb.bottom) d.y = this.droidLane;
      }
    }
    this.drawStarfield();
  }
}

export { IntroScene };
