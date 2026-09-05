# QA_VISUAL_0904B — Whole-game visual pass (post-overhaul), ground-truth browser renders

Method: headless-Chrome CDP captures of the ACTUAL running game (`client/_qa/cdp_shot.mjs`
/ `cdp_drive.mjs` — kept in repo, reruns deterministically). No synthetic previews used.
Evidence: `reports/qa_assets/0904B/*.png` (31 shots). Verify suites at HEAD (0902, commit 99e451e):
verify_sprites 304/304, verify_textures 114 keys/0 missing, verify_screens_wired 126/126.

## Verdict
The overhaul landed on assets and systems, but three P0-level presentation bugs survive,
and several P1 composition problems make the world read cheaper than its parts. The parts
are good; the FRAMING is what's soft.

---

## P0 — broken, must fix

### 0904B.1 `?scene=Intro` deep-link renders a black canvas
`intro.png`, `intro_early.png`: pure black + HUD chrome only. Live probe:
`{running:[], introActive:false, introChildren:0, cams:[]}` — `create()` never ran.
The deep-link swap (`client/game.js:91-111`) races the auto-advancing intro: by the
150ms `startIt` fires, the scheduler has IntroScene in a state where `game.scene.start()`
no-ops (it was just `stop()`ed in the loop above — `stop()` is deferred to next update,
and starting a scene that is mid-shutdown is a Phaser no-op). `?scene=Spaceship|Planet`
work because those scenes were never the active one at swap time.
**Fix:** in `startIt`, use `game.scene.stopAll()` then on `Phaser.Scenes.Events.STOP_ALL`
(or a one-frame `time.delayedCall`) call `game.scene.start(sceneKey, data)`; or check
`sc.sys.isTransition()` and retry next frame. Gate: assert `introChildren > 20` after boot
in a new `verify_deeplink.mjs`.

### 0904B.2 Planet HUD strips scroll with the camera (floating black bars)
Every planet shot carries one or two stray dark rectangles mid-scene (e.g. top-left bar at
screen (252,88) in `planet_day.png`, and in `w_*.png` panes the bars teleport to random
places). Probe at scroll (-130,890): `hudBar screen(610,-218)` → **completely off-screen**,
while the world keeps rendering. The 936×44 bottom strip + the 430×38 top-left panel are
created at world coords with DEFAULT scrollFactor(1) (`buildHUD`, PlanetScene.js:625-640).
Same class of bug as the 0904 panel bug the skill documents — the HUD was assumed anchored;
it isn't.
**Fix:** `.setScrollFactor(0)` on hudBar/hudAccent/hudText/hudDay (and audit `updateHUD` for
any re-created elements). Add a verify check: HUD rect `scrollFactor.x === 0`.

### 0904B.3 Dialogue header can ship `undefined undefined [--#]`
`panel_talk.png` / `dialog_probe.png`: header renders "undefined undefined [--#]" over a
legit line ("You seem nice. We barely know each o…" — also visibly **clipped mid-word**,
no wrap/ellipsis). `startNPCDialogue` (PlanetScene.js:3205) reads name/rank fields with no
guard when the arg isn't a fully-populated NPC object, and the dialog text box has no
truncation policy. A player hitting a half-initialised NPC (or a future data miss) gets a
literal `undefined` header in a shipping build.
**Fix:** fall back to `npc.name || npc.id || 'Unknown'`; drop the `[--#]` when rank is
absent; enable wordWrap + ` ellipsis` on the dialogue text; assert a header regex gate in
verify_story.

---

## P1 — ugly, should fix (harsh list)

### 0904B.4 Nebula backdrop is an obvious 3×3 grid — the intro's single cheapest element
`intro_bare.png`, `title_card.png`: `fx.nebula` tileSprite repeats with VISIBLE seams;
you can read the tile grid instantly (identical purple blobs at fixed offsets). One
tile + tilePositionX drift = wallpaper, not space.
**Fix:** 2–3 nebula tiles cross-faded (two tileSprites, offset + alpha 0.6/0.4,
different drift vectors), plus 4–6 hand-placed nebula cloud sprites breaking the pattern.

### 0904B.5 Intro crawl panel: giant flat slate slab
The 680×300 `crawlPanel` (fill 0x1b2436 @0.88, 3px teal stroke) occupies the middle
half of the screen and is the dullest object on it. Two-color, no gradient, no corner
brackets, no header — looks like a debug overlay. Text at 20px centered is fine but the
panel dwarfs it. Also the crawl pacing (40ms/char + 1200ms/line hold) makes the
full crawl ~40s — nobody reads it, they spam SPACE.
**Fix:** trim to ~4 lines of copy, panel to fit-content with colony corner-brackets +
a faint scanline texture; keep the teal stroke but 1px + corner glow ticks.

### 0904B.6 Title card house reads as an egg, not a habitat
`title_card.png`: at 2.2×, `bld.house` is a featureless teal capsule with two cream
slats; the ADD glow blooms it into a soft blob; orbit rings are near-invisible (alpha
0.28). The hero image of the game's title screen is a glowing egg. The type itself
("SPACE FARMER" amber) is the only strong element.
**Fix:** the title-card house should use the BIGGER habitat silhouette (dome + airlock +
antenna + window row) — either a dedicated 64px `bld.houseHero` or reuse the colony
house with a visible base plate; raise orbit-ring alpha to ~0.5 and put a small moon
sprite on the ellipse so the ring reads as motion, not a smudge.

### 0904B.7 Interiors float as postage stamps in a void
All five `int_*.png`: the ~340×300 room sits dead-center in a black 960×720 frame with
stray asteroid sprites and HUD bars in the void around it. It reads "modal dialog", not
"you walked inside". Additionally both ceiling lamps are muddy grey-brown ADD blobs
(the known glow-tint trap — they're washed by the dark wall, not amber).
**Fix:** (a) frame the interior: draw the habitat's outer hull ring / airlock collar and a
deck apron around the room, or fill the letterbox with a dim colony-corridor parallax
layer; (b) tint lamp pools to 0xffbe5a with alpha ≥0.25 and a tighter core (the skill's
own interior-pass lesson, not yet applied to ceiling fixtures).
Compositionally the rooms are GOOD (props distinct per kind, labels legible, door pad
clear) — it's the surround that's void.

### 0904B.8 Ship scene still reads cold + dot-grid floor
`ship.png`: walls vs deck are near-identical luminance; the "bulkhead contrast" pass
didn't separate them enough to read as a room; the deck's teal dot pattern repeats at
tile scale and reads as graph paper. Tutorial cards + C.O.R.A. panel are legible but
tiny (≈10px) at 960×720. The player reads well with its shadow.
**Fix:** darken wall tiles −12 luminance and warm the deck 1 step; replace the per-tile
dot motif with a per-4-tile deck-seam pattern (seams at block boundaries, not inside);
bump card text ≥12px. (Skill already logs the warm-overlay failure — stop overlaying,
repaint tiles.)

### 0904B.9 The farm is a brown slab — the biggest fantasy-look survivor
`planet_day.png` / `w_lake.png` top-left: the NW farm block is a huge uniform rust-brown
rectangle (tilled earth?) with zero texture variation, abutting grass at a razor seam.
Against slate+teal colony everywhere else it reads 1990s fantasy farmland — precisely
the look the user rejects. Also the "fence" of the field renders as a hairline dark
rectangle (wireframe ghost) — the fence posts only exist at corners; the perimeter line
is a 1px stroke.
**Fix:** give the farm soil a tilled-furrow tile (alternating 2px ridge rows like soil),
a sand/slate border ring, and actual fence post+beam sprites along the full perimeter
(farm-block, not one stroked rect).

### 0904B.10 Ground seams: adjacent region fills change color with hard edges
Everywhere: grass appears in 2–3 distinct green fills meeting at straight tile lines
(see `w_forest.png`: 3 vertical green bands; `w_river.png`: bright/dark grass split),
plaza slate and grass meet knife-straight. There is no transition banding (no scattered
tufts across the border, no dither). It reads as a color-coded map, not terrain.
**Fix:** in `buildSmoothGround`, blend 1-tile-wide transition rows between different
roles (pick neighbor role and dither 30% variants), like the shoreline water↔sand
contract already enforced — extend that contract to grass/plaza/soil borders and gate it.

### 0904B.11 Water is flat cyan with a dot grid
`w_lake.png`/`planet_day.png`: lake and river are one cyan fill + identical dot matrix
+ static shoreline. No depth banding, no ripple highlights, no foam at the sand line.
The beach sand ring itself is a single taupe band.
**Fix:** 2–3 water depth tones by distance-from-shore (the ground pipeline already knows
neighbors), a 1-tile foam edge sprite line on sand contact, slow scrolling highlight
offsets on the river flow axis.

### 0904B.12 Village/farm-edge "plot wireframe" rectangles = orphaned agri-deck overlay — ✅ FIXED (0904, this session)
ROOT CAUSE (verified by live probe): `fieldDeck` graphics in PlanetScene.js:270-288
strokes two `strokeRoundedRect` at HARDCODED rows 16–29 (7..18, 19..32) + faint
(alpha .18) furrow hairlines + 'AGRI-DECK 0x' labels — but `MapData.FARM` soil is at
rows 4–15. The farm moved, the overlay didn't: the outlines render one region SOUTH of
the actual soil, on empty grass, i.e. floating CAD-looking rectangles + ghost hairlines.
FIX SHIPPED: deck geometry (rects, furrows, labels) is now DERIVED by scanning the
`ground` grid for soil tiles (split deck at an interior non-soil column, midpoint
fallback) — no literal tile coordinates remain in the block. Label font 8px→10px
(also B.13). Attribute gate added in verify_screens_wired §6 (derived-scan required,
row-literal ban, soil-bounds-vs-FARM-zone self-consistency) and NEGATIVE-CONTROLLED:
re-injecting the old hardcoded block FAILS the gate, the fix PASSes. Live verify:
soilBounds (4,4)-(20,15), decks 4–11 / 13–20, labels on soil row 4, `labelOnSoil:true`.

### 0904B.13 Tiny type at world scale
Building nameplates ("The Home Nurture", "GE / Central", "AGR0-DECK-02"), NPC name tags,
DEEP DROP/ORE VEIN markers: ≈8px, thin, low-contrast over busy tiles; several are unread-
able at native resolution even after 2× zoom in the PNG. The game's signage is its UI and
it's whispering.
**Fix:** 10–11px + 3px stroke + a 1px dark plate behind world labels (the hub panel proves
the palette works when bigger). Gate: min fontSize on any Text in `verify_screens_wired`.

### 0904B.14 Day vs night barely differ; night glows are dots, not pools
`planet_day.png` vs `planet_night.png` are ~85% identical images. Lamps add small yellow
discs with no ground light-pool; the GE beacon glow is a hard-edged white-cyan ball
(overbloom, no falloff); window bloom is subtle to invisible at scene scale. Night should
restructure the read of the map.
**Fix:** nightOverlay alpha 0.46 → ~0.62 with a touch of blue; add radial ground pools
under each lamp (2–3 concentric ADD discs, amber, alpha .12/.07/.04); rebuild the beacon
glow as 3-stop falloff; make the day/night luminance delta a measurable gate (mean
luminance drop ≥25%).

### 0904B.15 Forest/mine: two tree species + clone bushes; static-noise cliff
`w_forest.png`: every tree is one of two silhouettes, every bush one sprite, repeated
verbatim (no flip/scale variance), and the map's east edge exposes the black void with a
sliver of nebula strip — the world ends in a cliff of nothing. `w_mine.png`: the cliff
tile is high-freq static (TV snow) with no strata banding; the mine plaza is empty slab
with sparse props.
**Fix:** flip/scale jitter (±15%) + 1 extra variant per flora; edge treatment: rim the
walkable world with cliff-edge or wall-hull tiles so black never touches ground; strata
bands (3 horizontal density bands) on cliff; scatter 6–8 more mine props (crate, drill,
rail cart) per the skill's lived-in pass.

### 0904B.16 Panel typography + one palette slip
Hub (`hub.png`) and shop (`panel_shopui.png`) are structurally good (rows, aligned meta,
clear headers) BUT: meta descriptions are ~10px dim grey-right-aligned and near-unread-
able; "ESC | B close"/"CLOSE: SPACE" footers are the faintest text on screen (they're
the most important); the shop panel's bright GREEN border breaks the teal-trim language
(one outlier hue across the whole UI set).
**Fix:** footer/hint text → amber #f7d698, ≥11px; unify ALL panel borders to the teal
0x67e1cd family; bump meta text one step.

---

## What's genuinely good (keep, don't regress)
- Colony Hub / panels composition & hierarchy — genuinely solid, just needs the type bump.
- Buildings scale-unified (the 64px fix holds); doors/pads read correctly; signage plates
  are well-placed (size only).
- Player/NPC sprites with shadows read clean on plaza decking; festival/alien kit distinct.
- Verify-suite culture is the reason no asset is *missing* — the 304 checks held.

## Priority order for the fix session
1. B.2 HUD scrollFactor (5-min, removes the most visible artifact in every world shot)
2. B.1 deep-link Intro (unblocks cheap future QA itself)
3. B.3 dialogue guard/wrap
4. B.9 farm slab + B.12 wireframe + B.10 ground seams (the "fantasy map" trio)
5. B.14 night delta + pools
6. B.7 interior surround (frame the room)
7. B.4/B.5/B.6 intro/backdrop/title hero art
8. B.11 water, B.15 edge/flora variance, B.13/B.16 typography
9. B.8 ship warmth by repainting tiles

Each fix needs an ATTRIBUTE gate (0904 lesson): measure the thing that broke
(scrollFactor, luminance delta, border hue histogram, tile-seam dither presence,
label min font size) — existence/dimension gates let all of these through green.
