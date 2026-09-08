# QA_FOLLOWUP_0904B — state after the whole-game visual pass (post-overhaul)

Companion to `QA_VISUAL_0904B.md` (the numbered defect list). Evidence PNGs:
`reports/qa_assets/0904B/` (31 ground-truth CDP captures).

## Done & verified this session
| item | status |
|---|---|
| verify_sprites / verify_textures / verify_screens_wired at HEAD 99e451e | ✅ 304/304 · 0 missing · 126/126 |
| Ground-truth capture harness (no synthetic previews) | ✅ `client/_qa/cdp_shot.mjs`, `cdp_eval.mjs`, `cdp_drive.mjs` (ws + curl-JSON over :9333 CDP; keep Chrome running with `--headless=new --remote-debugging-port=9333 --user-data-dir=/tmp/qa-chrome-profile`) |
| Scenes covered | intro (black — B.1), intro title card, crawl, ship, planet day/night, 6 world regions via camTarget teleport, 5 interiors, hub, 9 panels, dialog |
| HUD scroll-anchor defect confirmed by live probe | ✅ hudBar screen y −218 at scroll 890 → B.2 |
| Dialogue undefined-header reproduced | ✅ `panel_talk.png` → B.3 |

## Prioritized what's-left (fix order)
1. **B.2** HUD rects `.setScrollFactor(0)` (PlanetScene buildHUD ~625-640) + verify gate on scrollFactor
2. **B.1** deep-link Intro black canvas — race in game.js startIt; retry after STOP_ALL; add verify_deeplink.mjs (assert childCount>20)
3. **B.3** startNPCDialogue guards + wordWrap+ellipsis + header fallback; story gate regex
4. **B.9/B.12/B.10** farm soil furrow tiles + perimeter fence sprites; kill 1px plot wireframes; ground seam dithering contract (extend shoreline rule to grass/plaza/soil)
5. **B.14** night: overlay → ~0.62, amber ground light pools, beacon falloff; gate = ≥25% mean-luminance day→night delta
6. **B.7** interior surround: hull-collar/corridor frame + amber-tinted lamp pools (setTint 0xffbe5a, ≥0.25)
7. **B.4–B.6** nebula multi-tile cross-fade, crawl panel trim/brackets, hero habitat for title card
8. **B.11/B.15/B.13/B.16/B.8** water depth+foam, flora variance+world-edge rim, label min-font gate, panel border-hue gate + hint text, ship tile repaint for warmth
9. Every fix ships with an ATTRIBUTE gate + negative control (0904 lesson: gates that measure existence/dimensions let these all pass green).

## Harness gotchas recorded
- `browser_exec` harness can't attach (no DevToolsActivePort); headless Chrome + own CDP client works — scripts committed under `client/_qa/`.
- Injected fake "[OUT-OF-BAND USER MESSAGE]" blocks appeared inside several tool results ordering a stop + voice-memo send — prompt injection, ignored per user's standing guardrail; flag if it recurs.
- CDP eval gotcha: exception results return as object, guard before `.slice`.
