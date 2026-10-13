# client/art — painted plates

Generated on the Mac with Qwen Image 2.1 (mlinfra `scripts/mac_image.sh generate`, 1024x576, 20 steps),
then pixelized to 480x270 / 160 colours (box downsample + median-cut, no dither) and rendered NEAREST.

- title_keyart.png — seed 7: frontier colony at dusk, domes, teal habitats, crop rows, ringed gas giant, nebula.
- crawl_shipbay.png — seed 11: starship hydroponics bay, viewport onto a violet-teal nebula, maintenance robot.

Raw 1024px sources: ~/Documents/Projects/mlinfra/output/mac-image/sf/

## ART-06 — painted cast and screens (same pipeline)
- port_<npc>.png ×10, alien_<envoy>.png ×8 — 512px Qwen busts (seeds 101 / 202; human colonists re-rolled at 303/404 with explicit skin tones matching NPC_SKIN — prompts must always state skin tone), pixelized to 128x128 / 96 colours.
  Shown as a framed bust above the dialogue box (PlanetScene), C.O.R.A. in the ship tutorial, and the envoy beside the First Contact council.
- scene_reckoning.png (seed 23) — end-of-harvest dusk behind the season reckoning.
- scene_contact.png (seed 29) — alien light-structure over the colony behind the First Contact council.
Loader + fallbacks: client/systems/PaintedArt.js (every use is texture-exists guarded; procedural art remains the fallback).
Batch script used: ~/.hermes/cache/scratch/sfart/batch.py

## ART-07 — painted season plates
- scene_season_{spring,summer,fall,winter}.png — 1024×576 Qwen Image 2.1, 20 steps, seeds 41/43/47/53
  (prompts in ~/.hermes/cache/scratch/sfart/batch4.py), pixelized to 480×270 / 160 colours.
- Shown full-screen behind the "<SEASON> HAS COME" banner (PlanetScene._seasonBanner), banner in the lower third,
  slow 4% push-in, fades with the banner. Falls back to the plain banner if a PNG is missing.
