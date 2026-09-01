#!/usr/bin/env python3
"""Build a standalone HTML dashboard from Space Farmer evaluation reports."""
from __future__ import annotations
import argparse, html, json, statistics
from pathlib import Path
from typing import Any

def esc(value: Any) -> str:
    return html.escape(str(value), quote=True)

def avg(rows: list[dict[str, Any]], key: str) -> float | None:
    values = [float(row[key]) for row in rows if row.get(key) is not None]
    return statistics.fmean(values) if values else None

def num(value: float | None, digits: int = 1) -> str:
    return "-" if value is None else f"{value:.{digits}f}"

def load_reports(root: Path) -> list[dict[str, Any]]:
    paths = sorted(root.glob("*.json")) + sorted((root / "archive").glob("*.json"))
    reports = []
    for path in paths:
        if path.name == "models.json":
            continue
        try:
            report = json.loads(path.read_text(encoding="utf-8"))
        except json.JSONDecodeError:
            continue
        report["_path"], report["_archived"] = path, path.parent.name == "archive"
        reports.append(report)
    return reports

def details(report: dict[str, Any], registry: dict[str, Any]) -> dict[str, Any]:
    model = report.get("model", {})
    value = dict(registry.get("models", {}).get(model.get("name"), {}))
    value.update(registry.get("runs", {}).get(report["_path"].name, {}))
    for key in ("thinking", "reasoning_effort"):
        if key in model:
            value[key] = model[key]
    return value

def col(value) -> str:
    return "-" if value in (None, "") else str(value)

def episode_table(rows: list[dict[str, Any]], narrative: bool) -> str:
    body = []
    for row in rows:
        latency = row.get("mean_latency_ms")
        cells = [
            f"<td>{esc(row.get('seed', '-'))}</td>", f"<td>{num(row.get('reward'), 3)}</td>",
            f"<td>{num(row.get('credits'), 0)}</td>", f"<td>{esc(row.get('steps', '-'))}</td>",
        ]
        if narrative:
            cells += [
                f"<td>{col(row.get('days'))}</td>",
                f"<td>{col(row.get('quests'))}</td>",
                f"<td>{col(row.get('friends_made'))}</td>",
                f"<td>{col(row.get('journal_entries'))}</td>",
                f"<td>{col(row.get('festivals'))}</td>",
            ]
        cells += [
            f"<td>{num(latency)}{' ms' if latency is not None else ''}</td>",
            f"<td>{'yes' if row.get('capped') else 'no'}</td>",
            f"<td>{'yes' if row.get('replay_ok') else '-'}</td>",
            f"<td><code>{esc(row.get('trajectory', '-'))}</code></td>",
        ]
        body.append("<tr>" + "".join(cells) + "</tr>")
        testimony = row.get("testimony")
        if testimony:
            body.append(
                "<tr class='testimony'><td colspan=" + str(len(cells)) + "><small>Testimony — seed "
                + esc(row.get('seed', '-')) + "</small><pre>" + esc(testimony) + "</pre></td></tr>"
            )
    if not body:
        span = 14 if narrative else 8
        return f'<tr><td colspan="{span}">No completed episodes.</td></tr>'
    return "".join(body)

def card(report: dict[str, Any], registry: dict[str, Any]) -> str:
    model, env, policies = report.get("model", {}), report.get("environment", {}), report.get("episodes", {})
    rows, meta = policies.get("model", []), details(report, registry)
    expected, archived = len(env.get("seeds", [])), report["_archived"]
    complete = report.get("complete", expected > 0 and len(rows) == expected)
    status = "archived" if archived else ("complete" if complete else "in progress")
    if meta.get("validity") == "invalid" and not archived:
        status = "invalid fallback"
    thinking = "enabled" if meta.get("thinking") is True else "disabled" if meta.get("thinking") is False else "not recorded"
    latency_n = sum(row.get("mean_latency_ms") is not None for row in rows)
    narrative = all("days" in row for row in rows)
    chips = [meta.get("quantization"), meta.get("backend"), env.get("action_interface")]
    chip_html = "".join(f'<span class="chip">{esc(x)}</span>' for x in chips if x)
    metric = lambda label, value, hint: f'<div class="metric"><small>{esc(label)}</small><b>{esc(value)}</b><small>{esc(hint)}</small></div>'
    narrative_metrics = ""
    if narrative:
        narrative_metrics = '<div class="metrics">' + "".join([
            metric("Days survived", num(avg(rows, "days"), 0), "mean per episode"),
            metric("Quests done", num(avg(rows, "quests"), 1), "mean per episode"),
            metric("Friends made", num(avg(rows, "friends_made"), 1), "mean per episode"),
            metric("Journal entries", num(avg(rows, "journal_entries"), 1), "mean per episode"),
            metric("Festivals claimed", num(avg(rows, "festivals"), 1), "mean per episode"),
            metric("Unique tools", num(avg(rows, "unique_tools"), 1), "mean per episode"),
        ]) + '</div>'
    narrative_head = ("<th>Days</th><th>Quests</th><th>Friends</th><th>Journal</th><th>Fest'ls</th>" if narrative else "")
    return f"""<article class="card {'archived' if archived else ''}">
<header><div><small class="accent">{esc(meta.get('family', 'Local policy'))}</small><h2>{esc(meta.get('display_name', model.get('name', 'Unknown model')))}</h2><p>{esc(meta.get('checkpoint', model.get('name', '-')))}</p></div><span class="status">{status}</span></header>
<div class="chips">{chip_html}</div><div class="metrics">
{metric('Mean reward', num(avg(rows, 'reward'), 3), 'random ' + num(avg(policies.get('random', []), 'reward'), 3))}
{metric('Mean credits', num(avg(rows, 'credits'), 0), 'oracle reward ' + num(avg(policies.get('economic', []), 'reward'), 3))}
{metric('Mean steps', num(avg(rows, 'steps')), f"{sum(bool(x.get('capped')) for x in rows)} capped")}
{metric('Latency/action', num(avg(rows, 'mean_latency_ms')) + (' ms' if latency_n else ''), f"{latency_n}/{len(rows)} episodes")}</div>
{narrative_metrics}
<dl><div><dt>Progress</dt><dd>{len(rows)}/{expected or '?'}</dd></div><div><dt>Policy validity</dt><dd>{esc(meta.get('validity', 'not audited'))}</dd></div><div><dt>Thinking</dt><dd>{thinking}</dd></div><div><dt>Reasoning effort</dt><dd>{esc(meta.get('reasoning_effort', 'not recorded'))}</dd></div><div><dt>Quantization</dt><dd>{esc(meta.get('quantization', 'not recorded'))}</dd></div><div><dt>Context</dt><dd>{esc(meta.get('context_window', 'not recorded'))}</dd></div><div><dt>Backend</dt><dd>{esc(meta.get('backend', 'not recorded'))}</dd></div><div><dt>Speculation</dt><dd>{esc(meta.get('speculative_decoding', 'not recorded'))}</dd></div><div><dt>Hardware</dt><dd>{esc(meta.get('hardware', 'not recorded'))}</dd></div></dl>
<p><b>Reasoning provenance:</b> {esc(meta.get('reasoning_provenance', 'Not recorded.'))}</p><p><b>Serving provenance:</b> {esc(meta.get('source', 'Not recorded.'))}</p>{f'<p class="note">{esc(meta["note"])}</p>' if meta.get('note') else ''}
<details><summary>Per-seed trajectories</summary><div class="scroll"><table><thead><tr><th>Seed</th><th>Reward</th><th>Credits</th><th>Steps</th>{narrative_head}<th>Latency</th><th>Capped</th><th>Replay</th><th>Trajectory</th></tr></thead><tbody>{episode_table(rows, narrative)}</tbody></table></div></details><footer>Source: <code>{esc(report["_path"])}</code></footer></article>"""

def render(reports: list[dict[str, Any]], registry: dict[str, Any]) -> str:
    current = "".join(card(x, registry) for x in reports if not x["_archived"])
    archived = "".join(card(x, registry) for x in reports if x["_archived"])
    return f"""<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Space Farmer model evaluations</title><style>
:root{{--bg:#071018;--panel:#101d2a;--line:#29445b;--text:#eaf4ff;--muted:#91aabd;--accent:#62e5ff}}*{{box-sizing:border-box}}body{{margin:0;background:radial-gradient(circle at 10% 0,#183752,transparent 35rem),var(--bg);color:var(--text);font:15px/1.5 ui-monospace,monospace}}main{{width:min(1180px,calc(100% - 28px));margin:auto;padding:60px 0}}h1{{font:700 clamp(2.4rem,6vw,4.8rem)/1 system-ui;margin:.2em 0}}h2{{font-family:system-ui;margin:.2em 0}}p,footer{{color:var(--muted)}}.lead{{max-width:800px}}.section{{margin-top:52px}}.card{{background:#101d2af5;border:1px solid var(--line);border-radius:18px;padding:24px;margin:16px 0;box-shadow:0 20px 60px #0005}}.archived{{opacity:.75}}header{{display:flex;justify-content:space-between;gap:20px}}.accent,summary{{color:var(--accent)}}.status,.chip{{border:1px solid var(--line);border-radius:99px;padding:5px 10px;height:max-content}}.chips{{display:flex;flex-wrap:wrap;gap:7px;margin:16px 0}}.metrics,dl{{display:grid;grid-template-columns:repeat(4,1fr);gap:9px}}.metric,dl div{{background:#09141f;border:1px solid #1d3448;border-radius:10px;padding:12px}}.metric small,.metric b{{display:block}}.metric small,dt{{color:var(--muted);font-size:.72rem}}.metric b{{font:700 1.4rem system-ui}}dd{{margin:2px 0}}.note{{border-left:2px solid #ffc66d;padding-left:12px}}details{{margin-top:18px}}.scroll{{overflow:auto}}table{{width:100%;border-collapse:collapse;font-size:.78rem;margin-top:10px}}th,td{{text-align:left;border-bottom:1px solid var(--line);padding:8px;white-space:nowrap}}footer{{margin-top:14px;font-size:.72rem}}.testimony td{{background:#09141f;border:none;white-space:normal}}.testimony pre{{white-space:pre-wrap;color:#cfe0ef;font-size:.78rem;margin:.2rem 0;border-left:2px solid var(--line);padding-left:12px}}@media(max-width:760px){{.metrics,dl{{grid-template-columns:repeat(2,1fr)}}}}@media(max-width:480px){{.metrics,dl{{grid-template-columns:1fr}}header{{display:block}}}}</style></head><body><main><small class="accent">DETERMINISTIC AGENT BENCHMARK</small><h1>Space Farmer<br>model evaluations</h1><p class="lead">Repeated cards generated from evaluation JSON. Metrics and trajectories come from reports; serving, reasoning, and quantization details come from the checked metadata registry.</p><h2 class="section">Current protocol runs</h2>{current or '<p>No current reports.</p>'}<h2 class="section">Archived and non-comparable runs</h2>{archived or '<p>No archived reports.</p>'}</main></body></html>"""

def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--directory", type=Path, default=Path("reports/evals"))
    parser.add_argument("--output", type=Path)
    args = parser.parse_args()
    registry = json.loads((args.directory / "models.json").read_text(encoding="utf-8"))
    reports = load_reports(args.directory)
    output = args.output or args.directory / "report.html"
    output.write_text(render(reports, registry), encoding="utf-8")
    print(f"wrote {output} ({len(reports)} reports)")

if __name__ == "__main__":
    main()
