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
  }

  create() {
    const { width, height } = this.game.config;

    // ── Touch controls: present on every screen (Intro included) ──
    this.touchCtrl = new TouchControls(this);
    this.touchCtrl.build();

    // ── Backdrop: nebula tile + planet + twinkling stars ──
    this.nebula = this.add.tileSprite(width / 2, height / 2, width, height, tex('fx.nebula'));
    this.planet = this.add.image(width - 170, height - 190, tex('fx.planet'));
    this.planet2 = this.add.image(120, 150, tex('fx.planet')).setScale(0.55).setAlpha(0.6).setFlipX(true);

    this.stars = [];
    for (let i = 0; i < 180; i++) {
      this.stars.push({
        x: Math.random() * width,
        y: Math.random() * height,
        size: Math.floor(Math.random() * 3) + 1,
        alpha: Math.random() * 0.5 + 0.5,
        twinkleSpeed: Math.random() * 0.03 + 0.01,
        phase: Math.random() * Math.PI * 2,
      });
    }
    this.starGraphics = this.add.graphics();
    this.drawStarfield();

    // ── Cinematic depth: CRT scanlines + soft vignette + homeworld in the void
    this.vignette = this.add.tileSprite(width / 2, height / 2, width, height, tex('fx.vignette'))
      .setDepth(950).setAlpha(0.7);
    this.asteroid = this.add.image(width - 210, height - 150, tex('fx.asteroid'))
      .setDepth(940).setScale(0.85).setAlpha(0.9);
    // the guide droid (BEEP) drifts across the void as a cameo — a thread from
    // the crawl into the tutorial, so the ship's little guide is never a stranger
    this.introDroid = this.add.image(120, 300, tex('ship.droid')).setDepth(945).setScale(1.3).setAlpha(0.9);

    // ── Title card (hidden until the crawl finishes) ──
    this.titleCard = this.add.container(width / 2, height / 2).setVisible(false);
    const orbit = this.add.graphics();
    orbit.lineStyle(1, 0x67e1cd, 0.28).strokeEllipse(0, -116, 310, 102);
    orbit.lineStyle(2, 0xf2bd68, 0.5).beginPath().arc(0, -116, 155, 2.8, 4.7).strokePath();
    const titlePlate = this.add.rectangle(0, 36, Math.min(620, width * 0.78), 190, 0x071a20, 0.8)
      .setStrokeStyle(1, 0x67e1cd, 0.5);
    this.houseImg = this.add.image(0, -150, tex('bld.house')).setScale(2.2);
    this.houseGlow = this.add.image(0, -120, tex('bld.houseGlow')).setBlendMode(Phaser.BlendModes.ADD).setScale(2.2).setAlpha(0.8);
    const eyebrow = this.add.text(0, -28, story.intro.eyebrow, {
      fontFamily: "system-ui, 'Segoe UI', sans-serif", fontSize: '10px', fontStyle: 'bold', color: '#83c6ba',
    }).setOrigin(0.5);
    this.titleText = this.add.text(0, 22, story.intro.title, {
      fontFamily: "system-ui, 'Segoe UI', 'Trebuchet MS', sans-serif", fontSize: '48px', fontStyle: 'bold', color: '#f7d698',
      stroke: '#3b2915', strokeThickness: 5, shadow: { color: '#f2bd68', blur: 20, offset: 0, fill: true },
    }).setOrigin(0.5);
    const rule = this.add.rectangle(0, 66, 190, 2, 0x67e1cd, 0.7);
    this.subtitle = this.add.text(0, 89, story.intro.subtitle, {
      fontFamily: "system-ui, 'Segoe UI', sans-serif", fontSize: '13px', color: '#c6e8df',
      stroke: '#061116', strokeThickness: 3,
    }).setOrigin(0.5);
    this.pressStart = this.add.text(0, 142, story.intro.pressStart, {
      fontFamily: "system-ui, 'Segoe UI', sans-serif", fontSize: '11px', fontStyle: 'bold', color: '#f7d698',
      stroke: '#061116', strokeThickness: 3,
    }).setOrigin(0.5);
    this.titleCard.add([orbit, titlePlate, this.houseImg, this.houseGlow, eyebrow, this.titleText, rule, this.subtitle, this.pressStart]);

    // ── Text crawl (big, bright, on a dark panel for legibility) ──
    // Sliding window: only the last few lines stay on screen, so a long story
    // reads like a crawl instead of overflowing the panel.
    this.line = 0;
    this.charIndex = 0;
    this.shownLines = [];
    this.currentLine = '';
    this.titleShown = false;
    this.crawlWindow = 7;
    // dark backing panel so the crawl reads cleanly over the busy starfield
    this.crawlPanel = this.add.rectangle(width / 2, height * 0.42, Math.min(Math.round(width * 0.8), 680), 300, 0x1b2436, 0.88)
      .setStrokeStyle(3, 0x39c5bb, 0.75).setScrollFactor(0);
    this.textObject = this.add.text(width / 2, height * 0.42, '', {
      fontFamily: "system-ui, 'Segoe UI', 'Trebuchet MS', sans-serif",
      fontSize: '20px',
      color: '#eafff0',
      align: 'center',
      lineSpacing: 12,
      stroke: '#000000',
      strokeThickness: 3,
    }).setOrigin(0.5).setScrollFactor(0);

    // input: skip crawl (SPACE / A) or begin (once title shown)
    this.input.keyboard.on('keydown', (e) => {
      if (e.key === 'Space' || e.key === 'a' || e.key === 'A') this.handleSpace();
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
      // begin
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
      onComplete: () => { this.textObject.destroy(); this.crawlPanel.destroy(); },
    });
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

  drawStarfield() {
    const { width, height } = this.game.config;
    this.starGraphics.clear();
    // (nebula tile sits behind this graphics object — only draw stars)
    for (const s of this.stars) {
      const twinkle = 0.3 + Math.abs(Math.sin(s.phase + s.twinkleSpeed * this.time.now)) * 0.7;
      const alpha = s.alpha * twinkle;
      const brightness = Math.floor(alpha * 255);
      const color = (brightness << 16) | (brightness << 8) | brightness;
      this.starGraphics.fillStyle(color, alpha);
      this.starGraphics.fillRect(s.x, s.y, s.size, s.size);
    }
  }

  update() {
    // gentle parallax drift on the backdrop
    this.nebula.tilePositionX -= 0.02;
    this.nebula.tilePositionY -= 0.006;
    if (this.planet) this.planet.y += Math.sin(this.time.now * 0.0003) * 0.05;
    // the asteroid slowly tumbles through the void (rotation + bob)
    if (this.asteroid) {
      this.asteroid.rotation = Math.sin(this.time.now * 0.00018) * 0.07;
      this.asteroid.y += Math.sin(this.time.now * 0.0004) * 0.06;
    }
    // the droid drifts slowly across the nebula, bobbing and swaying like a
    // little probe — a living detail behind the crawl text
    if (this.introDroid) {
      const { width } = this.game.config;
      this.introDroid.x += 0.22;
      this.introDroid.y = 300 + Math.sin(this.time.now * 0.0008) * 9;
      this.introDroid.rotation = Math.sin(this.time.now * 0.0005) * 0.16;
      if (this.introDroid.x > width + 40) this.introDroid.x = -40;
    }
    this.drawStarfield();
  }
}

export { IntroScene };
