"""Build the static site's secondary pages from their sources.

    python -I tools/build_pages.py            (run from the repo root)

pages/method.src.html   -> web/method.html    (maths explainer + live simulator)
pages/evidence.src.html -> web/evidence.html  (research synthesis + embedded benchmark)
engine/outputs/*.png|gif -> web/img/
"""

import json
import shutil
from datetime import date
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
WEB = ROOT / "web"
ICON = ("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 32 32'%3E"
        "%3Cpath d='M16 3c5 7 9 12 9 17a9 9 0 0 1-18 0c0-5 4-10 9-17z' fill='%23e5484d'/%3E%3C/svg%3E")

NAV = """<nav class="dg-nav" aria-label="Damu Grid pages"><a class="dg-home" href="./">← Damu Grid live demo</a>
<a href="method.html"{m}>How it works</a><a href="evidence.html"{e}>Evidence</a>
<a href="https://github.com/bleymambwe/damu-grid" target="_blank" rel="noopener">Code</a></nav>
<style>.dg-nav{{display:flex;flex-wrap:wrap;gap:4px 16px;align-items:center;padding:10px 16px;border-bottom:1px solid var(--border, #ccc);
background:var(--panel, #fff);font:500 14px "IBM Plex Sans",system-ui,sans-serif;position:sticky;top:0;z-index:5}}
.dg-nav a{{color:var(--ink-2, #444);text-decoration:none}} .dg-nav a:hover,.dg-nav a[aria-current]{{color:var(--ink, #111)}}
.dg-nav .dg-home{{color:var(--accent, #0d6b63);font-weight:600;margin-right:auto}}</style>
"""


def wrap(src, page):
    """Artifact-style page (title/link/style first, then content) -> full HTML document."""
    cut = src.index("<div")
    head, body = src[:cut], src[cut:]
    nav = NAV.format(m=' aria-current="page"' if page == "method" else "",
                     e=' aria-current="page"' if page == "evidence" else "")
    return ("<!doctype html>\n<html lang=\"en\">\n<head>\n<meta charset=\"utf-8\">\n"
            "<meta name=\"viewport\" content=\"width=device-width,initial-scale=1,viewport-fit=cover\">\n"
            f"<link rel=\"icon\" href=\"{ICON}\">\n"
            f"{head}</head>\n<body>\n{nav}{body}\n</body>\n</html>\n")


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
    img = WEB / "img"
    img.mkdir(exist_ok=True)
    for name in ["network.gif", "stock_age.png", "delay_sweep.png", "rates.png", "cumulative_cost.png"]:
        shutil.copy2(ROOT / "engine" / "outputs" / name, img / name)
    print("built web/method.html, web/evidence.html, web/img/")


if __name__ == "__main__":
    main()
