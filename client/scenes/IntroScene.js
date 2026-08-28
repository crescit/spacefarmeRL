// IntroScene.js — Cinematic intro crawl
// Year 2987, Earth is a dustball, Galactic Farm Initiative
// 2000s 8-bit pixel art starfield backdrop

import { AudioSystem } from '../systems/AudioSystem.js';
import { TouchControls } from '../systems/TouchControls.js';

const INTRO_TEXT = [
  'YEAR 2987.',
  'EARTH IS A DUSTBALL.',
  '',
  'The Galactic Farm Initiative —',
  "humanity's last great project —",
  'seeded the cosmos with',
  'terraforming stations.',
  '',
  'Mars was tamed.',
  'Venus was harvested.',
  'A comet-based agri-platform',
  'orbited Jupiter.',
  '',
  'But the crown jewel was',
  'ASTEROID B-612 — a small',
  'rocky world with impossibly',
  'rich cosmic soil.',
  '',
  'Your grandfather built it.',
  'Tamed the solar winds.',
  'Made friends with the',
  'nebula-dwellers.',
  '',
  'He also left a note:',
  '"If you\'re reading this, I\'m dead,',
  '"and the compost is yours.',
  '',
  "Now he's gone.",
  'The farm — and the very large',
  'unpaid debt to Quasar —',
  'is yours.',
  '',
  "Welcome, farmer. There's food",
  'to grow, a colony to feed, and',
  'two AIs who may or may not',
  'love you.',
  '',
  '— SPACE FARMER —',
];

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
    this.nebula = this.add.tileSprite(width / 2, height / 2, width, height, 'fx.nebula');
    this.planet = this.add.image(width - 170, height - 190, 'fx.planet');
    this.planet2 = this.add.image(120, 150, 'fx.planet').setScale(0.55).setAlpha(0.6).setFlipX(true);

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
    this.vignette = this.add.tileSprite(width / 2, height / 2, width, height, 'fx.vignette')
      .setDepth(950).setAlpha(0.7);
    this.asteroid = this.add.image(width - 210, height - 150, 'fx.asteroid')
      .setDepth(940).setScale(0.85).setAlpha(0.9);

    // ── Title card (hidden until the crawl finishes) ──
    this.titleCard = this.add.container(width / 2, height / 2).setVisible(false);
    const orbit = this.add.graphics();
    orbit.lineStyle(1, 0x67e1cd, 0.28).strokeEllipse(0, -116, 310, 102);
    orbit.lineStyle(2, 0xf2bd68, 0.5).beginPath().arc(0, -116, 155, 2.8, 4.7).strokePath();
    const titlePlate = this.add.rectangle(0, 36, Math.min(620, width * 0.78), 190, 0x071a20, 0.8)
      .setStrokeStyle(1, 0x67e1cd, 0.5);
    this.houseImg = this.add.image(0, -150, 'bld.house').setScale(2.2);
    this.houseGlow = this.add.image(0, -120, 'bld.house_glow').setBlendMode(Phaser.BlendModes.ADD).setScale(2.2).setAlpha(0.8);
    const eyebrow = this.add.text(0, -28, 'A  B-612  FRONTIER  STORY', {
      fontFamily: "system-ui, 'Segoe UI', sans-serif", fontSize: '10px', fontStyle: 'bold', color: '#83c6ba',
    }).setOrigin(0.5);
    this.titleText = this.add.text(0, 22, 'SPACE FARMER', {
      fontFamily: "system-ui, 'Segoe UI', 'Trebuchet MS', sans-serif", fontSize: '48px', fontStyle: 'bold', color: '#f7d698',
      stroke: '#3b2915', strokeThickness: 5, shadow: { color: '#f2bd68', blur: 20, offset: 0, fill: true },
    }).setOrigin(0.5);
    const rule = this.add.rectangle(0, 66, 190, 2, 0x67e1cd, 0.7);
    this.subtitle = this.add.text(0, 89, 'Grow a future at the edge of the known sky', {
      fontFamily: "system-ui, 'Segoe UI', sans-serif", fontSize: '13px', color: '#c6e8df',
      stroke: '#061116', strokeThickness: 3,
    }).setOrigin(0.5);
    this.pressStart = this.add.text(0, 142, 'SPACE  /  TAP  TO  ARRIVE', {
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
      .setStrokeStyle(3, 0x39c5bb, 0.75);
    this.textObject = this.add.text(width / 2, height * 0.42, '', {
      fontFamily: "system-ui, 'Segoe UI', 'Trebuchet MS', sans-serif",
      fontSize: '20px',
      color: '#eafff0',
      align: 'center',
      lineSpacing: 12,
      stroke: '#000000',
      strokeThickness: 3,
    }).setOrigin(0.5);

    // input: skip crawl (SPACE) or begin (once title shown)
    this.input.keyboard.on('keydown', (e) => {
      if (e.key === 'Space') this.handleSpace();
    });
    this.input.on('pointerdown', () => this.handleSpace());

    this.nextLine();

    // ── Audio: boot BGM + SFX on first input (autoplay policy) ──
    this.audio = new AudioSystem(this);
    const bootAudio = () => { this.audio.boot(); if (window.SpaceFarmer?.music) window.SpaceFarmer.music.setContext('intro'); };
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
    const win = this.shownLines.slice(-this.crawlWindow);
    this.textObject.setText(win.map((l, i) => i === win.length - 1 ? l + this.currentLine : l).join('\n'));
  }

  nextLine() {
    if (this.line >= INTRO_TEXT.length) {
      this.showTitle();
      return;
    }
    this.currentLine = '';
    this.charIndex = 0;
    const full = INTRO_TEXT[this.line];
    this.line++;
    this.shownLines.push(full);   // keep blank spacer lines as paragraph breaks
    this._renderCrawl();
    this.typeNext(full);
  }

  typeNext(full) {
    if (this.charIndex >= full.length) {
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
    this.drawStarfield();
  }
}

export { IntroScene };
