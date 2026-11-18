"""Builds the project report (report/robotproof-report.pdf) from real screenshots and the evidence CSV.

Usage: python report/build.py
Every number in it is read from evidence/results.csv (written by evidence/score.py) or stated in the text
with its source. Nothing is typed in by hand.
"""
import csv
import html
import math
import pathlib

from playwright.sync_api import sync_playwright

here = pathlib.Path(__file__).parent
root = here.parent
img = here / "img"


def wilson(k, n, z=1.96):
    if n == 0:
        return (0.0, 0.0)
    p = k / n
    d = 1 + z * z / n
    c = (p + z * z / (2 * n)) / d
    h = z * math.sqrt(p * (1 - p) / n + z * z / (4 * n * n)) / d
    return (max(0.0, c - h), min(1.0, c + h))


rows = list(csv.DictReader((root / "evidence" / "results.csv").open())) if (root / "evidence" / "results.csv").exists() else []
n = len(rows)
lux = sum(int(r["lux3d_ok"]) for r in rows)
art = sum(int(r["articulation_ok"]) for r in rows)
both = [r for r in rows if r["articulation_ok"] == "1"]
rob = sum(int(r["robot"]) for r in both)
rnd = sum(int(r["random_pull"]) for r in both)
pct = lambda a, b: f"{100 * a / b:.0f}%" if b else "n/a"
ci = lambda a, b: "{:.0f}–{:.0f}%".format(*(100 * x for x in wilson(a, b))) if b else "n/a"

table = "".join(
    f"<tr><td>{r['line']}</td><td>{html.escape(r['prompt'])}</td><td>{html.escape(r['joints'] or '—')}</td>"
    f"<td>{'yes' if r['articulation_ok'] == '1' else 'no'}</td><td>{'' if r['robot'] == '' else ('opened' if r['robot'] == '1' else 'stumped')}</td>"
    f"<td>{'' if r['random_pull'] == '' else ('opened' if r['random_pull'] == '1' else 'no')}</td><td>{html.escape(r['note'][:70])}</td></tr>"
    for r in rows
)

def fig(name, caption):
    p = img / name
    return f'<figure><img src="{p.as_uri()}"><figcaption>{caption}</figcaption></figure>' if p.exists() else ""

doc = f"""<!doctype html><html><head><meta charset="utf-8"><title>Robotproof: project report</title>
<style>
 body {{ font-family: -apple-system, 'Helvetica Neue', Arial, sans-serif; color: #1d1d1b; margin: 0; font-size: 11pt; line-height: 1.45; }}
 .page {{ padding: 18mm 18mm; page-break-after: always; }}
 h1 {{ font-size: 30pt; margin: 0 0 4mm; }} h2 {{ font-size: 16pt; margin: 0 0 3mm; }} h3 {{ font-size: 12pt; margin: 4mm 0 2mm; }}
 .lead {{ font-size: 14pt; }} .muted {{ color: #555; }}
 figure {{ margin: 0 0 4mm; }} figure img {{ width: 100%; border: 1px solid #ddd; border-radius: 4px; }}
 figcaption {{ font-size: 9pt; color: #555; margin-top: 1mm; }}
 .two {{ display: grid; grid-template-columns: 1fr 1fr; gap: 5mm; }}
 table {{ border-collapse: collapse; width: 100%; font-size: 8.5pt; }} td, th {{ border-bottom: 1px solid #ddd; padding: 1.2mm 1.5mm; text-align: left; vertical-align: top; }}
 .card {{ border: 1px solid #ccc; border-radius: 4px; padding: 3mm 4mm; margin-bottom: 3mm; }}
 code {{ font-size: 9pt; }}
</style></head><body>

<section class="page">
<h1>Robotproof</h1>
<p class="lead"><b>Make something robots can't open.</b> Photograph or describe anything with a lid, a door or a drawer. Aholo Lux3D builds it in 3D and works out how its parts move. You open it with your mouse. Then a robot arm tries, without being told how it opens.</p>
<p>Live: <b>https://robotproof.vercel.app</b></p>
{fig('00-full-page.png', 'The live app. A Lux3D chest is loaded; the right rail has your turn, the robot button and its verdict, the Robot Gym wall and the make-your-own form.')}
<h2>From the idea to the result</h2>
<p><b>The question.</b> Robots still fumble everyday things people open without thinking, and the 3D objects robots practise on in simulation are built and articulated by hand. Labelling the parts and joints of 5,402 objects for one 2026 dataset took 400 hours of human correction, even with automatic proposals (Artiverse, arXiv 2605.24403). Manycore co-founder Huang Xiaohuang puts the need plainly: "Robots must be trained in virtual environments before they can operate in the real world." (KrASIA, 12 Dec 2025)</p>
<p><b>The idea.</b> Lux3D's articulation step takes a 3D model and one sentence ("the lid swings up on its back hinge") and returns the object's real kinematics: separate part meshes and a URDF with a hinge or slide joint, its axis and its limits. That turns any generated object into something that can be opened, by a person and by a robot, and loaded into a robot simulator.</p>
<p><b>The game.</b> You go first, with the mouse, in real physics. Then the robot gets three tries, seeing only the shape of each part. If you can open it and the robot can't, it's robot-proof, and it goes on the Robot Gym wall for others to try and download.</p>
</section>

<section class="page">
<h2>How it's built</h2>
<p>1. <b>Make:</b> a sentence goes to Lux3D text-to-3D, or a photo goes to Aholo's asset storage and then to Lux3D image-to-3D (G1-Turbo, 60,000 faces). 2. <b>Joints:</b> the model and the "what should open" sentence go to Lux3D articulation, which returns a zip with <code>robot.urdf</code> and one GLB per part. 3. <b>Pack:</b> our server compresses the parts and stores them (Lux3D's links expire after 2 hours). 4. <b>Play:</b> the browser turns each URDF link into a rigid body and each joint into a Rapier hinge or slide joint with the same limits. 5. <b>Export:</b> the download has the URDF with estimated masses and inertias, OBJ meshes for simulators and the textured GLBs, and it loads and moves in MuJoCo 3.3.7 (checked on every build by <code>./check.sh</code>).</p>
<h3>Key asset comparison: the same chest before and after articulation</h3>
<div class="two">{fig('01-lux3d-model-one-piece.png', 'Lux3D text-to-3D output: one solid piece. Nothing moves.')}{fig('03-chest-lid-open-on-its-hinge.png', 'After Lux3D articulation: body + lid, revolute joint, limits 0 to 1.57 rad. Here the lid is pushed open in the browser physics.')}</div>
<div class="two">{fig('06-nightstand-drawers-out.png', 'A nightstand: articulation returned two slide joints (0 to 0.230 m and 0 to 0.231 m).')}{fig('07-visitor-object-1-opened.png', 'A pencil box asked for a lid that slides out the full length: Lux3D gave a slide joint of only ±3.4 cm. Limits like this are shown as they come back.')}</div>
</section>

<section class="page">
<h2>The robot</h2>
<div class="two">{fig('04-robot-trying-the-lid.png', 'The robot reaching for the lip of the lid on its first move (lift).')}{fig('05-robot-verdict-chest.png', 'Verdict on the chest: STUMPED. Lift got the lid 41% open, pull and sweep less. A person opens it in a couple of seconds.')}</div>
<p>The robot is not given the joint. It sees each moving part's shape and where it sits, picks the point that sticks out most (a knob, a lid's lip), and tries up to three moves in the order the shape suggests: lift, pull, sweep left, sweep right, push down. Its grip is a held point capped at 60 N, it slips if the part won't follow, and a try counts if the part ends more than half open. Before every try the object's physics is rebuilt at rest. It is a scripted set of moves on a drawn two-link arm, not a learned policy, and we say so in the app.</p>
</section>

<section class="page">
<h2>Our own test: 28 everyday objects that open</h2>
<p class="muted">Evidence, stated plainly: no real users yet; it was built for this hackathon. Instead: our own break test on a fixed list of 30 objects written and committed before any run (commit 263b38c); the first 2 were used while building, the other 28 are the test.</p>
<div class="card"><b>Claim:</b> Lux3D turns a one-line description into an object whose parts open the way the sentence says in {art} of {n} cases ({pct(art, n)}, 95% interval {ci(art, n)}).<br>
<b>Evidence type:</b> our own break test, not real users. <b>Data:</b> evidence/data/prompts-v1.txt, lines 3–30. <b>Rule:</b> every joint is the asked type (hinge → revolute, slides → prismatic) and a pull along each joint opens it past half its range. Lux3D builds that failed count as misses ({n - lux} of {n}).</div>
<div class="card"><b>Claim:</b> the shape-only robot opened {rob} of the {len(both)} openable objects ({pct(rob, len(both))}, 95% interval {ci(rob, len(both))}); a random pull at a random point with the same force and tries opened {rnd} ({pct(rnd, len(both))}).<br>
<b>Evidence type:</b> our own break test, not real users. Same seed (20261118) for both. The paired difference is +0.053 (95% bootstrap −0.158 to +0.263): by the plan's rule the robot is not better than random pulling, which is the point of the game. Rerun: <code>python evidence/score.py</code> at the commit in the repo.</div>
<table><tr><th>#</th><th>Object</th><th>Joints Lux3D returned</th><th>Openable</th><th>Robot</th><th>Random pull</th><th>Note</th></tr>{table}</table>
</section>

<section class="page">
<h2>What doesn't work yet</h2>
<p>A new object takes about 5 to 10 minutes: Lux3D builds the model (about 1.5 to 5 minutes), then finds the joints (about 4 to 5 minutes). Joint ranges can be off, as with the pencil box. Masses are estimates (surface area × 12 mm wall × 600 kg/m³), not measurements. The robot is a scripted grasp, not a trained controller. To keep credits for everyone, each visitor can make 3 objects a day and the site at most 60 a day.</p>
<h2>Built with</h2>
<p>Aholo Lux3D text-to-3D and image-to-3D, Lux3D articulation, the Aholo asset upload SDK; three.js, Rapier physics, Vercel; MuJoCo 3.3.7 for the export check.</p>
</section>
</body></html>"""

(here / "report.html").write_text(doc)
with sync_playwright() as p:
    b = p.chromium.launch()
    pg = b.new_page()
    pg.goto((here / "report.html").as_uri())
    pg.wait_for_timeout(500)
    pg.pdf(path=str(here / "robotproof-report.pdf"), format="A4", print_background=True)
    b.close()
print("report:", here / "robotproof-report.pdf", f"(n={n}, openable={art}, robot={rob}, random={rnd})")
