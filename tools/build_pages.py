"""Build the static site's secondary pages from their sources.

    python -I tools/build_pages.py            (run from the repo root)

pages/method.src.html   -> web/method.html    (maths explainer + live simulator)
pages/evidence.src.html -> web/evidence.html  (research synthesis + embedded benchmark)
pages/overview.src.html -> web/overview.html  (submission overview)
engine/outputs/*.png|gif -> web/img/

Every page shares web/css/tokens.css and the left rail below; secondary pages also load
web/css/pages.css, which maps their components onto the shared tokens.
"""

import json
import shutil
from datetime import date
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
WEB = ROOT / "web"
ICON = ("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 32 32'%3E"
        "%3Ccircle cx='16' cy='16' r='16' fill='%2312306b'/%3E"
        "%3Cpath d='M16 7c3.4 4.6 6 8 6 11.2a6 6 0 0 1-12 0C10 15 12.6 11.6 16 7z' fill='%23fff'/%3E%3C/svg%3E")

# Shared left rail; web/index.html carries the same markup by hand. key, href, label, svg body.
RAIL_ITEMS = [
    ("overview", "overview.html", "Overview",
     '<rect x="4" y="4" width="7" height="7" rx="2"/><rect x="13" y="4" width="7" height="7" rx="2"/>'
     '<rect x="4" y="13" width="7" height="7" rx="2"/><rect x="13" y="13" width="7" height="7" rx="2"/>'),
    ("demo", "./", "Live demo",
     '<circle cx="6" cy="7" r="2.4"/><circle cx="18" cy="6" r="2.4"/><circle cx="12" cy="17" r="2.4"/>'
     '<path d="M8 7.6l8-1M7 9l4 6M17 8l-4 7" fill="none" stroke-width="1.8"/>'),
    ("method", "method.html", "How it works",
     '<path d="M5 4h9l5 5v11H5z" fill="none" stroke-width="1.8"/><path d="M8 12h8M8 16h6" fill="none" stroke-width="1.8"/>'),
    ("evidence", "evidence.html", "Evidence",
     '<path d="M5 20V10M10 20V5M15 20v-7M20 20V8" fill="none" stroke-width="2.2" stroke-linecap="round"/>'),
    ("code", "https://github.com/bleymambwe/damu-grid", "Code on GitHub",
     '<path d="M9 8l-4 4 4 4M15 8l4 4-4 4" fill="none" stroke-width="2" stroke-linecap="round"/>'),
]
NL = chr(10)


def rail(active):
    """Left navigation rail with `active` (a RAIL_ITEMS key) highlighted."""
    out = ['<nav class="rail" aria-label="Damu Grid">',
           '  <a class="mark" href="./" aria-label="Damu Grid home"><svg viewBox="0 0 32 32" aria-hidden="true">'
           '<path d="M16 7c3.4 4.6 6 8 6 11.2a6 6 0 0 1-12 0C10 15 12.6 11.6 16 7z"/></svg></a>',
           '  <span class="sep" aria-hidden="true"></span>']
    for key, href, label, svg in RAIL_ITEMS:
        on = key == active
        ext = ' target="_blank" rel="noopener"' if href.startswith("http") else ""
        cur = ' aria-current="page"' if on else ""
        cls = "ico on" if on else "ico"
        out.append(f'  <a class="{cls}" href="{href}"{cur}{ext} title="{label}" aria-label="{label}">'
                   f'<svg viewBox="0 0 24 24" aria-hidden="true">{svg}</svg></a>')
    out.append("</nav>")
    return NL.join(out)


def wrap(src, page):
    """Artifact-style page (title/link/style first, then content) -> full HTML document in the shared shell."""
    cut = src.index("<div")
    head, body = src[:cut], src[cut:]
    parts = [
        "<!doctype html>", '<html lang="en">', "<head>", '<meta charset="utf-8">',
        '<meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover">',
        f'<link rel="icon" href="{ICON}">',
        head.rstrip(),
        '<link rel="stylesheet" href="css/tokens.css">',
        '<link rel="stylesheet" href="css/pages.css">',
        "</head>", "<body>", rail(page), '<div class="dg-main">', body.rstrip(), "</div>", "</body>", "</html>", "",
    ]
    return NL.join(parts)


def embed_benchmark(html):
    res = json.loads((ROOT / "results" / "benchmark_results.json").read_text())
    nar = json.loads((ROOT / "results" / "narrative.json").read_text(encoding="utf-8"))
    log, ch = res["log"], res["log"]["chosen"]
    payload = {
        "summary": log["summary"], "settings": log["settings"], "train_seeds": log["train_seeds"],
        "test_seeds": log["test_seeds"], "horizon": 365,
        "chosen_text": (f"π₂ᵗ cover {ch['age'][1]}, β {ch['age'][2]}; band b = {ch['band'][1]}; "
                        f"SAA K {ch['saa'][1]}, S {ch['saa'][2]}, θ {ch['saa'][3]}; nowcast q {ch['nowcast_q']}"),
        "verdict": nar["verdict"], "findings": nar["findings"],
        "generated": f"Benchmark: {len(res['runs'])} simulation runs and {len(res['bounds'])} perfect-information LPs. "
                     f"Page built {date.today().isoformat()}.",
    }
    tag = '<script id="bench" type="application/json">'
    start = html.index(tag) + len(tag)
    end = html.index("</script>", start)
    return html[:start] + json.dumps(payload, ensure_ascii=False).replace("</", "<\\/") + html[end:]


def main():
    method = (ROOT / "pages" / "method.src.html").read_text(encoding="utf-8")
    (WEB / "method.html").write_text(wrap(method, "method"), encoding="utf-8")
    evidence = embed_benchmark((ROOT / "pages" / "evidence.src.html").read_text(encoding="utf-8"))
    (WEB / "evidence.html").write_text(wrap(evidence, "evidence"), encoding="utf-8")
    overview = (ROOT / "pages" / "overview.src.html").read_text(encoding="utf-8")
    (WEB / "overview.html").write_text(wrap(overview, "overview"), encoding="utf-8")
    img = WEB / "img"
    img.mkdir(exist_ok=True)
    for name in ["network.gif", "stock_age.png", "delay_sweep.png", "rates.png", "cumulative_cost.png"]:
        shutil.copy2(ROOT / "engine" / "outputs" / name, img / name)
    print("built web/method.html, web/evidence.html, web/overview.html, web/img/")


if __name__ == "__main__":
    main()
