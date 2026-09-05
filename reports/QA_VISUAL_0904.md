# Space Farmer — Visual QA Pass (branch 0902, commit ffdd6ca)
Date: 2026-09-04 · Method: preview_*.mjs contact sheets + objective pixel metrics from SpriteSystem.
Verification gates all green (they are NOT catching the things below — see "Gate blindness" last).

verify_sprites 219/219 · verify_textures 0 missing · verify_screens_wired 118/118 ·
verify_festival_day 36/36 · verify_calendar 17/17.

## Verdict
The systems are healthy; the ART direction is not. Colony palette discipline is inconsistent
(brown dirt in three separate places), interiors are one beige template with 4 floating cards
in every room, and the title card's text system has a broken space glyph. Below is the fix list,
ordered by blast radius, with acceptance criteria per stage.

────────────────────────────────────────
## Stage 1 — Terrain / ground tiles (MapData + SpriteSystem.GROUND)
Evidence: /tmp/sf_qa/planet_day.png, pixel stddev metrics.

1.1 CRITICAL — dirt brown roads in a space colony. The four 'path' feeder trails
    (farm gate, mine path, lake path, forest path) render as sandy-brown dirt cutting
    through the teal plaza grid. Charter says colony decking, not dirt. The main roads
    ARE plaza-correct (MapData L74–76) — only the feeders violate it.
    FIX: map 'path' to a desaturated slate/granule decking variant (or reuse plaza with a
    darker, matte palette). ACCEPT: no tile with mean luminance hue in the brown band
    (r>g>b by >15) outside the farm field + beach.
1.2 CRITICAL — the lake reads as a flat cyan billboard. water sd=4.48 with a single
    45° hatch texture; the sand ring (sd=7.90) is a hard 1-tile uniform belt with a
    razor edge against grass and water. No shoreline variation, no depth gradation,
    no foam line. FIX: 2–3 water variants with varying hatch density/phase + a 2-tile
    wet-sand darkening band at the shoreline.
1.3 MAJOR — the six grass variants are a lie: grassA..grassF are BYTE-IDENTICAL
    (0 differing pixels across 1024-px samples). The map "varies" tiles but the eye
    sees one tile stamped everywhere → the huge open fields read as wallpaper.
    FIX: actually differentiate the variants (tuft clusters, patches, speckles seeded
    per-variant), or delete the fake variants and accept a repeat with visible noise.
    ACCEPT: pairwise pixel-diff > 3% between any two variants.
1.4 MAJOR — the whole overworld reads texture-starved: grass tiles (sd=6.05) pass the
    old ≥5 bar but at 32px the surface reads flat-washed; cliff (sd=19) shows how much
    contrast budget is available. Raise grass/soil contrast into 7–10 via denser
    speckle/grain, keeping hue.
1.5 MAJOR — sparse world. The rendered frame shows 1 tree and 1 purple rock in a
    quadrant of empty green; DECOR=69 on a 64×48 map is still thin. Scatter ambient
    flora in clusters (groves read as clusters, singles read as errors).
1.6 MINOR — the brown farm field (top-left) and tilled soil (bottom-left, sd=3.09)
    are near-flats; furrows need visible row structure — farm tiles are the game's
    hero surface, they should be the HIGHEST contrast tiles, not the lowest.

## Stage 2 — Buildings (SpriteSystem buildings, MapData BUILDINGS)
Evidence: /tmp/sf_qa/buildings.png, planet_day.png.

2.1 CRITICAL — the barn is a brown fantasy hut with gingerbread windows; it is the
    single worst palette outlier in the set (three of the four neighbours are
    slate/teal habitat modules). Rebuild it in the habitat language (a pressurised
    agricultural module with grow-light glow would sell 'barn' better and stay on-palette).
2.2 MAJOR — scale drift: the barracks (3rd sprite) is drawn much smaller/lighter than
    its 64px siblings and its base plinth doesn't share their baseline weight. It will
    read as a garden shed next to the exchange. Match the 64×64 registered footprint
    and base-shadow mass.
2.3 MAJOR — the shop (2nd) is a dark, heavy, squat box while the home (1st) is a light
    glass dome; the set has no shared silhouette grammar (base plinth + wall band +
    roof cap). Every module should share those three bands so a row of buildings reads
    as one architecture. Currently they read as 4 unrelated clipart stickers.
2.4 MINOR — beacon lights float detached above roofs on thin stalks with no mount
    detail; add a mount ring/strut so they read attached.
2.5 MINOR — window light logic is arbitrary (glow count/placement differs per building
    with no pattern a player can learn, e.g. 'windows = open for business').

## Stage 3 — Interiors (PlanetScene._decorateRoom, int.* props)
Evidence: /tmp/sf_qa/interior_{home,shop,tavern,exchange,ranch}.png.

3.1 CRITICAL — all five rooms are the SAME room. Same shell, same central light disc,
    same ~5 props at the same anchor points, only prop glyphs swapped. Home = bed +
    stove + chest floating mid-floor; shop = 4 cards; exchange = a terminal card.
    Zero identity per function. FIX: per-kind composition rules — furniture must be
    functional clusters (tavern: bar counter with back-bar shelves + 2 tables w/ stools
    + hearth glow; shop: counter + stocked shelf walls; ranch: pens + feed bins + an
    actual ANIMAL, currently no livestock anywhere in the ranch room).
3.2 CRITICAL — props float. Every prop is a card with an elliptical drop-shadow a few
    px below and no ground contact (see the egg-domes and the vending slab in home).
    The 'cards over a table' look kills the illusion the room is a floor. Props must
    sit ON the deck: shadow hugging the base, consistent light direction from the
    ceiling pools, foot-level occlusion at the wall seam.
3.3 MAJOR — the light "pool" is a generic grey ellipse pasted over the middle of
    every room with identical size/alpha; it does not emanate from a visible fixture.
    Tie every pool to a ceiling luminaire sprite directly above it; vary size/position
    per room.
3.4 MAJOR — 60%+ dead floor in every room. The deck texture is so dark it reads as
    void, so empty floor looks like missing content. Either raise deck contrast a step
    or compose furniture to occupy the play area.
3.5 MINOR — wall vs floor separation is one teal band at the same height in all rooms;
    add per-room wall dressing (screens, piping, signage naming the building — a
    'SHOP' holosign over the counter would do more than any prop).

## Stage 4 — Characters (PLAYER/NPC/ALIEN sprites)
Evidence: /tmp/sf_qa/characters.png, villagers.png.

4.1 MAJOR — heads are ~45% of body height; at game scale this is 'chibi blob'
    territory. The bodies are undetailed slabs: torso reads as one flat colour with
    one badge dot. Add 2–3 value steps per garment (collar, seam, hem shade).
4.2 MAJOR — feet are detached grey capsules with a gap above the body in several
    frames (alien, right column) — walk cycles will look like skating stumps. Feet
    must articulate from the leg hem.
4.3 MAJOR — silhouette variety is near zero from the back: 8 characters all reduce to
    'head + one-colour rectangle'. Readability at 32px must survive without the face:
    give each NPC a distinct outline prop (apron, backpack, tool loop, hat brim).
4.4 MINOR — cheek-blush dots are identical on every human face (same 2 px, same pink)
    → copy-paste signature. Vary or drop.
4.5 OK — faces are readable, skin-tone variety is good, palette stays mostly on
    language (the droid is great; the tan alien with orange spots is fine).

## Stage 5 — Portraits
Evidence: /tmp/sf_qa/portraits.png.

5.1 MAJOR — expressions are the same portrait ×3 rows with a mouth toggled; no
    brows, no eye change. Dialogue will feel dead on emotion beats. Need brow + eye
    layer per expression (neutral/happy/angry/surprised), not just a mouth.
5.2 MAJOR — the droid portraits (col 1 & 10) are a generic machine shot, not the
    droid's character sprite from Stage 4 — likeness breaks between UI and world.
5.3 MINOR — nameplate bars reuse shirt colours that nearly match the subject's shirt
    (blue-on-blue col 8); plate colour should contrast the subject by rule (complementary, not same-family).
5.4 MINOR — thin coloured gutter lines between cells bleed into the portraits at
    export time; frame with a consistent 2px slate gutter.

## Stage 6 — Tools / festival kit
Evidence: /tmp/sf_qa/festival_tools.png.

6.1 MAJOR — pickaxe and hoe are indistinguishable at target size (both = brown stick
    + grey head); only scale differs. Distinguish by head shape + material tint
    (pick = double point, hoe = L blade) so the swing animation reads what action is happening.
6.2 MAJOR — the fishing rod is a 1px hairline hook — invisible at game scale, and it
    is the only prop using a 1px stroke (line-weight is off-language; everything else
    is 2px min).
6.3 MINOR — held tools render over the character's HAT instead of the hand (see the
    watering-can swing frames: can covers the brow). Anchor to hand offset, not head.
6.4 OK — festival stall/stage are on-palette and read acceptably.

## Stage 7 — Ship cabin scene
Evidence: /tmp/sf_qa/ship_cabin.png.

7.1 MAJOR — the 'warm tone' still has not landed (known, now verified again): the
    room is 90% desaturated slate with teal dots; the only warm objects are two
    picture frames that read as BROWN CARDBOARD against the metal — they introduce
    a 5th material (craft paper) instead of warming the scene. Warm it via amber
    light pools from visible ceiling fixtures, wood-tone = dark amber metal veneer,
    not beige paper.
7.2 MAJOR — props stack with no floor contact: the two frames overlap each other and
    the console like a pile of boxes; the egg display floats. Same Stage-3 floating-
    card disease.
7.3 MINOR — porthole dots are uniform grid sprinkles, identical dot everywhere; no
    stars, no planet, no view. A window to space would both warm and deepen the scene.

## Stage 8 — Intro / title card
Evidence: /tmp/sf_qa/intro_title.png.

8.1 CRITICAL — the bitmap font has NO space glyph: every ' ' renders as a '✱' sparkle
    block. Source strings are correct ("SPACE FARMER", "ASTEROID B-612 YEAR 2987" in
    shared/story/intro.js) — the preview and the in-game font both draw a dot for space.
    The whole title screen looks like a corrupted message. FIX the glyph table (space =
    blank advance, zero ink). ACCEPT: title render with pixel-clean word spacing.
8.2 MAJOR — the title plate is a dark board on a dark nebula; contrast of the mint
    text is fine, but the eyebrow/subtitle rows (teal, cream) fall below legibility at
    the small glyph size; the '✱' corruption makes it worse. Raise subtitle size or add
    a darker plate behind all three text rows.
8.3 MINOR — the house silhouette landmark from the crawl does not appear on the title
    card (IntroScene adds houseImg/houseGlow to the card; the preview shows none) —
    check they're positioned on-canvas; the two orange planets repeat identically and
    the lower-right one collides with the star field.
8.4 MINOR — nebula reads as soft blobs (big blur discs) rather than a starfield with
    structure; add 2–3 layers of star parallax + 1 denser band.

────────────────────────────────────────
## Gate blindness (why the verify suites are green despite all this)
- verify_sprites checks key EXISTENCE and fixed dims, never CONTRAST. Add the
  luminance-stddev bar per GROUND tile as an assertion (path=2.75 and soil=3.09 would
  have failed a ≥4 gate; identical grass variants would have failed a pairwise-diff gate).
- verify_screens_wired checks routing, not composition. Add an interior-composition
  check: each room kind must reference ≥1 unique prop key (currently all rooms share the
  same generic set, so nobody notices the tavern has no bar).
- No test renders the title TEXT; the broken space glyph shipped unnoticed. Add a
  preview_intro pixel assertion: 'SPACE FARMER' row must contain ≥1 fully-blank column
  between words.
- The 2px-min line-weight rule exists nowhere. Add a stroke-width check for prop sprites.

## Fix order for the agent
1) space glyph (8.1) — 1-line, ship immediately.
2) 'path' tile → colony decking (1.1) + barn rework (2.1) + cardboard frames → amber
   metal (7.1) — the three brown/paper palette breaches.
3) Ground: real grass variants + water/shoreline variants + soil furrow contrast (1.2–1.6).
4) Interiors: ground-contact shadows, per-room prop sets incl. tavern bar & ranch animals,
   luminaire-tied light pools (3.1–3.5).
5) Buildings: shared 3-band silhouette grammar + barracks scale (2.2–2.3).
6) Characters/tools/portraits passes (4, 5, 6).
7) Close the gates (Gate blindness section) so this class of defect fails CI, not QA day.
