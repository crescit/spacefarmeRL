# QA Follow-up 0904 — graphics overhaul closeout

Branch: 0902. Baseline: `verify_sprites` 304 passed / 0 failed,
`verify_screens_wired` 126 / 0, `verify_textures` 0 missing,
aliens/festival/story/calendar suites green, all `preview_*.mjs` regen OK.

## Done + verified (this pass)

| Item | Fix | Verification |
|---|---|---|
| 1.5 world density | bush/flora/meadow clusters in MapData DECOR; minefoot scatter; two lone bushes | `flora read as clusters` gate (isolated non-border plants ≤ 8) + `no decor stands in water / on a building / on a blocked tile` gate, both green |
| 1.5 layout bugs | planter off the barn footprint (6,4)→(6,10); lake-standing alien_flora removed; meadow relocated off Exchange/lake to a probed-open tile | walkability audit probe + the decor-placement gate |
| 2.2–2.5 windows | shop display-bay occlusion removed; two warm windows flank the bay; shopGlow halo aligned to them; `litWhen` rule wired — commercial (shop/tavern/exchange) glow by DAY (open for business), residential (home/barracks) at NIGHT (lived-in); breathing gated by kind | `carries the lit-window rule` pixel gate + PlanetScene `litWhen` source gates |
| 2.4 beacons | mast/collar mount under every roof beacon (shop, cantina, ranch silo, barracks) | `beacon sits on a mount (mast ink under the bulb)` pixel gate |
| 3.3 light pools | `hang()` pairs fixture+pool in buildRoom: brightened slate-on-slate-proof housing, warm collar under the emitter, amber-tinted pool at the shell's ~5x scale, top edge meeting the emitter. Unpaired legacy pool deleted | `hang() pairs them` gate + pixel scan of interior_shop.png (grey housing rows + amber emitter rows at lamp columns) + vision pass |
| 3.4 room signs | `sign()` = slate plate housing (teal bezel, hang stem, open-pip) + the room WORD as real stroked text; GROCER/TAVERN/TRADE/RANCH/BUNKS per kind | `every room kind gets a named holosign` (≥6 calls) + `signplate word is drawn as real stroked text` + plate-mass pixel gate |
| 6.3 tool anchor | tool rides the hand row (+18) with origin at the grip; swing angle positive (arc away from head) | `tool sprite anchors to the hand row` + `swing tilts AWAY` gates, scoped to the function body |
| 8.2–8.4 intro | three-layer parallax starfield (far dust / mid band / near pinwheels); eyebrow + subtitle legibility (size, stroke, plate opacity) | regen `intro_title.png`; stale single-array refs grepped clean |
| Stage 5 sheet | portrait contact sheet: 2px slate gutters per cell; identity chips keylined (light outline + dark mount) so dark-shirted NPCs no longer sink blue-on-blue | vision pass on `portraits_small.png` — chips readable, faces distinct, droids structurally distinct |
| Preview honesty | `preview_interiors` roomMock + home room now MIRROR buildRoom's hang() at the scene's exact scales; fixed the preview's `blit` fractional-scale bug (inner loop bound `sy < s` dropped rows — 4.3 drew 4 of every pixel's rows, hiding the lamps) | pixel scan of the regenerated sheet shows the fixtures |

## Negative controls (gate-blindness protocol)

All 14 fire: unpaired pool, deleted fixtures, bare-label sign, head-height tool
offset, floating bulb, scraped bezel, unlit facade. One lesson recorded: the
tool-anchor probe must slice the function body — a whole-file slice caught
`Math.hypot(px - 27, py - 22)` in the shore test and false-fired.

## Vision-pass notes

- The first two interior rounds were PREVIEW lies, not scene bugs: the mock's
  120px grey `C.glow` ellipse was the "sourceless blob"; the untinted
  lamp_glow core over blue-slate composites grey at low alpha (measured
  [107,115,116]) — fixed with amber tint 0xffbe5a at alpha .32/.30 and the
  blit fix. Ground-truth pixel scans before each vision read caught both.
- Buildings sheet: shop shows its two warm windows; beacons read mounted.

## Left (nice-to-have, no QA red-flag)

- Day/night play-through of the window-light rule via `?scene=planet&night=1`
  deep-link on the live client (headless suites cover the rule statically).
- Festival-decor clustering pass if festival maps grow more props.
