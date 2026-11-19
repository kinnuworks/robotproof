"""Writes app/public/results.html: every object in our own test, its result, and a link that opens that
exact object in the live app so anyone can drag it, let the robot try and teach it.

Usage: python3 evidence/results_page.py
Reads evidence/results.csv, evidence/teach.csv and evidence/data/prompts-v1.txt (nothing typed by hand).
The objects are the committed ones in evidence/data/objects, served at objects/<9000000 + line>/.
"""
import csv
import html
import math
import pathlib

here = pathlib.Path(__file__).parent
root = here.parent
BLOB = "https://qhuaqity4gffgh3y.public.blob.vercel-storage.com/objects/"


def wilson(k, n, z=1.96):
    p = k / n
    d = 1 + z * z / n
    c = (p + z * z / (2 * n)) / d
    h = z * math.sqrt(p * (1 - p) / n + z * z / (4 * n * n)) / d
    return f"{100 * max(0, c - h):.1f}% to {100 * min(1, c + h):.1f}%"


rows = list(csv.DictReader((here / "results.csv").open()))
teach = {r["line"].lstrip("0"): r for r in csv.DictReader((here / "teach.csv").open())}
n = len(rows)
art = [r for r in rows if r["articulation_ok"] == "1"]
rob = sum(int(r["robot"]) for r in art)
rnd = sum(int(r["random_pull"]) for r in art)
im = sum(int(t["imitate"]) for t in teach.values())
sh = sum(int(t["shape_only"]) for t in teach.values())


def cell(v, yes="opened", no="stumped"):
    return "" if v == "" else (f'<td class="y">{yes}</td>' if v == "1" else f'<td class="n">{no}</td>')


body = []
for r in rows:
    line = r["line"].lstrip("0")
    has = (here / "data" / "objects" / f"{int(line):02d}" / "robot.urdf").exists()
    t = teach.get(line)
    link = f'<a href="/?base={BLOB}{9000000 + int(line)}/">open it</a>' if has else "—"
    body.append(
        f"<tr><td>{line}</td><td>{html.escape(r['prompt'])}</td><td>{html.escape(r['joints'] or '—')}</td>"
        f"<td>{'yes' if r['articulation_ok'] == '1' else 'no'}</td>"
        f"{cell(r['robot']) if r['robot'] != '' else '<td></td>'}"
        f"{cell(r['random_pull']) if r['random_pull'] != '' else '<td></td>'}"
        f"{cell(t['imitate']) if t else '<td></td>'}"
        f"<td>{link}</td><td class='note'>{html.escape(r['note'][:80])}</td></tr>"
    )

page = f"""<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>Robotproof: our test, object by object</title>
<link rel="preconnect" href="https://fonts.googleapis.com"><link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link href="https://fonts.googleapis.com/css2?family=Bricolage+Grotesque:opsz,wght@12..96,400..800&display=swap" rel="stylesheet">
<style>
 body {{ font-family: "Bricolage Grotesque", system-ui, sans-serif; background: #e9e1d8; color: #111; margin: 0; padding: 24px 16px 48px; }}
 main {{ max-width: 1080px; margin: 0 auto; background: #fbf8f5; border-radius: 10px; padding: 28px 24px; }}
 h1 {{ font-size: clamp(28px, 5vw, 44px); line-height: 1.05; margin: 0 0 12px; font-weight: 800; }}
 p {{ font-size: 16px; line-height: 1.5; max-width: 760px; }}
 .cards {{ display: grid; grid-template-columns: repeat(auto-fit, minmax(220px, 1fr)); gap: 12px; margin: 20px 0; }}
 .card {{ background: #ffde3b; border-radius: 8px; padding: 14px 16px; }}
 .card b {{ display: block; font-size: 34px; font-weight: 800; }}
 .wrap {{ overflow-x: auto; }}
 table {{ border-collapse: collapse; width: 100%; font-size: 14px; min-width: 760px; }}
 th, td {{ text-align: left; padding: 8px 6px; border-bottom: 1px solid #e3dbd2; vertical-align: top; }}
 th {{ font-weight: 700; }}
 td.y {{ color: #1d6b2a; font-weight: 700; }} td.n {{ color: #9b1c6a; font-weight: 700; }}
 td.note {{ color: #555; font-size: 12px; }}
 a {{ color: #000; font-weight: 700; }}
</style></head><body><main>
<p><a href="/">← Robotproof</a></p>
<h1>Our test, object by object</h1>
<p>Evidence, stated plainly: no real users. This is our own break test on {n} everyday objects from a list written and committed before any run. Every row links to the exact object the numbers came from: open it, drag it, press <b>Let the robot try</b>, then <b>Teach it</b>, and see for yourself.</p>
<div class="cards">
 <div class="card"><b>{len(art)} of {n}</b>came back from Lux3D with parts that open the way the sentence said (95% interval {wilson(len(art), n)})</div>
 <div class="card"><b>{rob} of {len(art)}</b>opened by the robot that only sees the shape (a random pull: {rnd} of {len(art)})</div>
 <div class="card"><b>{im} of {len(teach)}</b>opened after one demonstration ({wilson(im, len(teach))}; without it, {sh} of {len(teach)})</div>
</div>
<p>"Opens" means every moving part ends more than half open. The demonstrations in the test are scripted stand-ins for a person's drag; in the app, the demonstration is your own drag. Reruns: <code>evidence/score.py</code> and <code>evidence/teach.py</code> in the repository, with the rule in <code>evidence/EVAL_PLAN.md</code>.</p>
<div class="wrap"><table>
<tr><th>#</th><th>What we asked for</th><th>Joints Lux3D returned</th><th>Opens as asked</th><th>Robot, shape only</th><th>Random pull</th><th>Robot, shown once</th><th>Try it</th><th>Note</th></tr>
{''.join(body)}
</table></div>
</main></body></html>"""
(root / "app" / "public" / "results.html").write_text(page)
print("wrote app/public/results.html", f"(n={n}, openable={len(art)}, robot={rob}, random={rnd}, taught={im}/{len(teach)})")
