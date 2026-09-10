#!/usr/bin/env python3
"""Render a Space Farmer trajectory as a readable "day in the life" diary.

The anti-hellscape artifact: a spring on B-612 you can actually read — morning
briefings, tool calls, the world's prose replies, journal entries — instead of a
row of JSON. Output: Markdown (default) and a self-contained HTML page.
"""
from __future__ import annotations

import argparse
import html
import json
from pathlib import Path
from typing import Any

TOOL_GLYPH = {
    "till": "🛠", "plant": "🌱", "water": "💧", "harvest": "🌾", "sell": "🪙",
    "buyAnimal": "🐔", "feedAnimal": "🌾", "upgradeTool": "⚒", "fish": "🎣",
    "mine": "⛏", "gift": "🎁", "talk": "💬", "claimFestival": "🎆",
    "advance": "🌙", "rest": "🌙", "read_colony_log": "📜",
    "write_journal": "📖", "get_state": "📊", "inspect": "🔍",
}


def _native_label(record: dict[str, Any]) -> str:
    native = record.get("native_action") or {}
    t = native.get("type", record.get("action", "?"))
    bits = []
    for key in ("tileX", "tileY"):
        if key in native:
            bits.append(str(native[key]))
    if native.get("crop"):
        bits.append(native["crop"])
    if native.get("npc"):
        bits.append(native["npc"])
    if native.get("item"):
        bits.append(native["item"])
    label = t
    if bits:
        label += "(" + ", ".join(bits) + ")"
    return label


def _day(record: dict[str, Any]) -> int:
    return int((record.get("observation") or {}).get("day", 1))


def _records(path: Path) -> list[dict[str, Any]]:
    rows = [json.loads(line) for line in path.read_text(encoding="utf-8").splitlines() if line]
    if not rows or rows[0].get("kind") != "space-farmer-trajectory":
        raise ValueError(f"not a Space Farmer trajectory: {path}")
    return rows


def build_diary(path: Path) -> tuple[dict[str, Any], list[tuple[int, list[dict[str, Any]]]]]:
    rows = _records(path)
    header, rest = rows[0], rows[1:]
    summary = next(
        (record for record in reversed(rest) if record.get("kind") == "episode-summary"),
        None,
    )
    transitions = [record for record in rest if not record.get("kind")]
    days: list[tuple[int, list[dict[str, Any]]]] = []
    for record in transitions:
        if days and days[-1][0] == _day(record):
            days[-1][1].append(record)
        else:
            days.append((_day(record), [record]))
    stats = {
        "seed": header.get("seed"),
        "action_interface": header.get("action_interface", "?"),
        "days_lived": len(days),
        "actions": len(transitions),
        "total_reward": round(sum(float(r.get("reward", 0)) for r in transitions), 2),
        "final_credits": (transitions[-1].get("observation") or {}).get("credits", 0) if transitions else 0,
        "final_stamina": (transitions[-1].get("observation") or {}).get("energy", 0) if transitions else 0,
        "stamina_max": (transitions[-1].get("observation") or {}).get("staminaMax", 100) if transitions else 100,
        "narrative": (summary or {}).get("stats") or {},
        "testimony": (summary or {}).get("testimony") or "",
    }
    return stats, days


def _narrative_line(stats: dict[str, Any]) -> str:
    n = stats.get("narrative") or {}
    if not n:
        return ""
    parts = []
    for key, label in (
        ("daysSurvived", "days survived"), ("questsCompleted", "quests completed"),
        ("friendsMade", "friends made"), ("journalEntries", "journal entries"),
        ("festivalsClaimed", "festivals claimed"), ("seedsPlanted", "seeds planted"),
        ("cropsHarvested", "harvests"),
    ):
        if n.get(key) not in (None, 0, ""):
            parts.append(f"{n[key]} {label}")
    return " · ".join(parts) if parts else "nothing recorded of the season yet"


def render_markdown(path: Path) -> str:
    stats, days = build_diary(path)
    out: list[str] = [f"# A Season on B-612 — seed {stats['seed']}",
                      "", f"*{stats['actions']} actions · {stats['days_lived']} days lived · "
                          f"reward {stats['total_reward']} · {stats['final_credits']} cr at dusk · "
                          f"stamina {stats['final_stamina']}/{stats['stamina_max']}*", ""]
    narrative = _narrative_line(stats)
    if narrative:
        out.append(f"> Record: {narrative}")
        out.append("")
    for day, records in days:
        out.append(f"## Day {day}")
        for record in records:
            native = record.get("native_action") or {}
            glyph = TOOL_GLYPH.get(native.get("type", ""), "•")
            label = _native_label(record)
            prose = (record.get("prose") or "").strip() or "The world takes that quietly."
            reward = float(record.get("reward", 0))
            out.append(f"- {glyph} **{label}** — {prose} {_reward_tag(reward)}")
        out.append("")
    if stats.get("testimony"):
        out.append("---")
        out.append("## Testimony — what kind of keeper were you?")
        out.append("")
        out.append(stats["testimony"])
        out.append("")
    out.append("---")
    out.append("_Replay-verified trajectory · generated from `" + str(path) + "`_")
    return "\n".join(out)


def _reward_tag(reward: float) -> str:
    if reward > 0:
        return f"_(+{reward:.2f})_"
    if reward < 0:
        return f"_({reward:.2f})_"
    return ""


def render_html(path: Path) -> str:
    stats, days = build_diary(path)
    glyph = lambda t: TOOL_GLYPH.get(t, "•")
    narrative = _narrative_line(stats)
    record_html = ""
    if narrative:
        record_html = f'<p class="stats narrative">Record: {html.escape(narrative)}</p>'
    day_html = []
    for day, records in days:
        rows = []
        for record in records:
            native = record.get("native_action") or {}
            label = _native_label(record)
            prose = html.escape((record.get("prose") or "").strip() or "The world takes that quietly.")
            reward = float(record.get("reward", 0))
            tag = f"<span class='reward'>{'+' if reward > 0 else ''}{reward:.1f}</span>" if reward else ""
            rows.append(f"<li><span class='glyph'>{glyph(native.get('type',''))}</span>"
                        f"<span class='act'>{html.escape(label)}</span> "
                        f"<span class='prose'>{prose}</span> {tag}</li>")
        day_html.append(f"<h3>Day {day}</h3><ul>{''.join(rows)}</ul>")
    testimony_html = ""
    if stats.get("testimony"):
        testimony_html = (f'<h2>Testimony — what kind of keeper were you?</h2>'
                          f'<pre class="testimony">{html.escape(stats["testimony"])}</pre>')
    return f"""<!doctype html><html><head><meta charset="utf-8"><title>B-612 · seed {stats['seed']}</title>
<style>
  body{{max-width:760px;margin:2rem auto;padding:0 1rem;background:#081018;color:#e7f0ee;font-family:system-ui,sans-serif}}
  h1{{color:#f8d797}} h3{{color:#8dc9c0;border-bottom:1px solid #1d3a40;padding-bottom:.25rem}}
  ul{{list-style:none;padding:0}} li{{margin:.4rem 0}}
  .glyph{{margin-right:.5rem}} .act{{color:#ffe9a0;font-weight:600}}
  .prose{{color:#cdd9d6}} .reward{{color:#b9f0a0;font-size:.85em;margin-left:.4rem}}
  .stats{{color:#93aeb7;font-size:.9em;margin-bottom:1.5rem}} .narrative{{color:#f8d797}}
  .testimony{{background:#0d1a24;border-left:3px solid #62e5ff;padding:1rem;white-space:pre-wrap;color:#cfe0ef}}
</style></head><body>
<h1>A Season on B-612 — seed {stats['seed']}</h1>
<div class="stats">{stats['actions']} actions · {stats['days_lived']} days · reward {stats['total_reward']} ·
{stats['final_credits']} cr at dusk · stamina {stats['final_stamina']}/{stats['stamina_max']}</div>
{record_html}
{''.join(day_html)}
{testimony_html}
<p><em>Replay-verified trajectory.</em></p>
</body></html>"""


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("trajectory", type=Path)
    parser.add_argument("--out", type=Path, help="output dir (writes <name>.md and <name>.html)")
    args = parser.parse_args()
    out_dir = args.out or args.trajectory.parent
    out_dir.mkdir(parents=True, exist_ok=True)
    stem = args.trajectory.stem
    md = out_dir / f"{stem}.md"
    page = out_dir / f"{stem}.html"
    md.write_text(render_markdown(args.trajectory), encoding="utf-8")
    page.write_text(render_html(args.trajectory), encoding="utf-8")
    print(f"diary: {md}")
    print(f"page:  {page}")


if __name__ == "__main__":
    main()
