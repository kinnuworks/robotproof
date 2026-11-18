"""Evidence claim 3 (EVAL_PLAN.md, "teaching the robot"): on the 19 openable test objects, does one
demonstration let the robot open what its shape-only tries could not?

Usage: python evidence/teach.py <base url serving evidence objects at /eval-objects/NN/> <out csv>
Per object with articulation_ok = 1 in evidence/results.csv:
  shape_only         the shape-only robot (default hand), as in claim 2
  shape_only_damped  the same robot with the critically damped hand imitate uses
  imitate            the robot copying a recorded demonstration: the scripted pull along each joint
                     (a stand-in for a person's drag) recorded at 30 Hz as the part centre's world path
"""
import csv
import pathlib
import sys

from playwright.sync_api import sync_playwright

base, out_csv = sys.argv[1].rstrip("/"), pathlib.Path(sys.argv[2])
here = pathlib.Path(__file__).parent
SEED = 20261118
ok_lines = {r["line"] for r in csv.DictReader((here / "results.csv").open()) if r["articulation_ok"] == "1"}

SCRIPT = """async ({seed}) => {
  const {world, robot} = window.__robotproof;
  const o = world.object;
  const V = (x, y, z) => o.parts[0].samples[0].clone().set(x, y, z);
  // The demonstration: the scripted pull along each joint (as in score.py), recorded every 2 steps (30 Hz).
  const demos = new Map();
  for (const j of o.joints) {
    robot.reset();
    const part = j.child;
    const c = part.samples.reduce((a, v) => a.add(v), V(0,0,0)).multiplyScalar(1 / part.samples.length);
    let dir = j.def.type === 'prismatic' ? j.axis.clone() : j.axis.clone().cross(c.clone().sub(j.anchor)).normalize();
    if (Math.abs(j.def.lower) > Math.abs(j.def.upper)) dir.negate();
    const local = part.mesh.worldToLocal(c.clone());
    const path = [], t = [], joint = [];
    for (let i = 0; i < 360; i++) {
      for (const q of o.parts) q.body.resetForces(true);
      const p = part.mesh.localToWorld(local.clone());
      const f = dir.clone().multiplyScalar(part.mass * 20);
      part.body.addForceAtPoint({x: f.x, y: f.y, z: f.z}, {x: p.x, y: p.y, z: p.z}, true);
      world.step(world.physics.timestep);
      if (i % 2 === 0) { path.push(part.mesh.localToWorld(local.clone())); t.push(i / 60); joint.push(world.openness(j)); }
    }
    demos.set(part.name, {part: part.name, local, path, t, joint});
  }
  robot.reset();
  const a = await robot.run({seed});
  robot.reset();
  const b = await robot.run({seed, damping: 'critical'});
  robot.reset();
  const c = await robot.imitate(demos, {});
  return {shape: a.stumped.length === 0, damped: b.stumped.length === 0, imitate: c.stumped.length === 0,
          imitateOpen: c.attempts.map(x => x.opened)};
}"""

rows = []
with sync_playwright() as p:
    browser = p.chromium.launch(args=["--use-gl=swiftshader", "--enable-unsafe-swiftshader"])
    page = browser.new_page(viewport={"width": 1000, "height": 700})
    for d in sorted((here / "data" / "objects").iterdir()):
        if not (d / "result.json").exists() or str(int(d.name)) not in ok_lines and d.name not in ok_lines:
            continue
        page.goto(f"{base}/?base=/eval-objects/{d.name}/")
        page.wait_for_function("window.__robotproof && window.__robotproof.ready && window.__robotproof.id === 'shared'", timeout=90000)
        page.evaluate("() => window.__robotproof.pause(true)")
        r = page.evaluate(SCRIPT, {"seed": SEED})
        row = {"line": d.name, "shape_only": int(r["shape"]), "shape_only_damped": int(r["damped"]), "imitate": int(r["imitate"]),
               "imitate_open": " ".join(f"{x:.2f}" for x in r["imitateOpen"])}
        rows.append(row)
        print(row, flush=True)
    browser.close()

with out_csv.open("w", newline="") as f:
    w = csv.DictWriter(f, fieldnames=list(rows[0].keys()))
    w.writeheader()
    w.writerows(rows)
n = len(rows)
print(f"n={n}; shape-only {sum(r['shape_only'] for r in rows)}/{n}; shape-only damped {sum(r['shape_only_damped'] for r in rows)}/{n}; imitate {sum(r['imitate'] for r in rows)}/{n}")
