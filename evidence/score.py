"""Evidence step 2: score every generated test object in the real page (headless Chromium, same physics).

Usage: python evidence/score.py <base url serving evidence objects at /eval-objects/NN/> <out csv>
Per object (evidence/data/objects/NN/result.json):
  articulation_ok  1 if Lux3D returned a URDF whose joint types match the sentence (hinge -> revolute,
                   slides -> prismatic) and a scripted pull along each joint opens it past half its range.
  robot            1 if the robot (shape only, no joint data, 3 attempts per part, 60 N) opens every part.
  random_pull      1 if the baseline (random grip point on the part, random direction, 3 attempts, same
                   force and seed) opens every part.
Lux3D failures count as articulation_ok = 0. Robot and baseline are scored only where articulation_ok = 1.
"""
import csv
import json
import pathlib
import sys

from playwright.sync_api import sync_playwright

base, out_csv = sys.argv[1].rstrip("/"), pathlib.Path(sys.argv[2])
root = pathlib.Path(__file__).parent / "data" / "objects"
SEED = 20261118

SCRIPT = """async ({wantType, seed}) => {
  const {world, robot} = window.__robotproof;
  const o = world.object;
  const THREE_V = (x, y, z) => o.parts[0].samples[0].clone().set(x, y, z);
  // Metric 1: pull along each joint's own direction (uses the joint, unlike the robot).
  robot.reset();
  const joints = o.joints.map(j => ({type: j.def.type, name: j.def.name}));
  const typesOk = o.joints.length > 0 && o.joints.every(j => j.def.type === wantType);
  let pullOk = true;
  for (const j of o.joints) {
    robot.reset();
    const part = j.child;
    const c = part.samples.reduce((a, v) => a.add(v), THREE_V(0,0,0)).multiplyScalar(1 / part.samples.length);
    let dir;
    if (j.def.type === 'prismatic') dir = j.axis.clone();
    else dir = j.axis.clone().cross(c.clone().sub(j.anchor)).normalize();
    // open toward the limit farther from rest (0), the same rule world.openness uses
    if (Math.abs(j.def.lower) > Math.abs(j.def.upper)) dir.negate();
    for (let i = 0; i < 360; i++) {
      for (const q of o.parts) q.body.resetForces(true);
      const f = dir.clone().multiplyScalar(part.mass * 20);
      part.body.addForceAtPoint({x: f.x, y: f.y, z: f.z}, {x: c.x, y: c.y, z: c.z}, true);
      world.step(world.physics.timestep);
    }
    if (world.openness(j) < 0.5) pullOk = false;
  }
  robot.reset();
  const rob = await robot.run({seed});
  // Baseline: random grip point on the part and random direction, same force, attempts and seed.
  let s = seed >>> 0; const rnd = () => ((s = (s * 1664525 + 1013904223) >>> 0) / 2 ** 32);
  const base = await robot.run({seed, strategyFor: (part, i) => {
    const g = part.samples[Math.floor(rnd() * part.samples.length)].clone();
    const d = THREE_V(rnd() * 2 - 1, rnd() * 2 - 1, rnd() * 2 - 1).normalize();
    return {strategy: 'random', dir: d, grip: g};
  }});
  return {joints, typesOk, pullOk, robotStumped: rob.stumped, robotAttempts: rob.attempts, baseStumped: base.stumped};
}"""

rows = []
with sync_playwright() as p:
    browser = p.chromium.launch(args=["--use-gl=swiftshader", "--enable-unsafe-swiftshader"])
    page = browser.new_page(viewport={"width": 1000, "height": 700})
    for d in sorted(root.iterdir()):
        rec = json.loads((d / "result.json").read_text()) if (d / "result.json").exists() else None
        if rec is None:
            continue
        want = "prismatic" if "slide" in rec["moves"].lower() else "revolute"
        row = {"line": rec["line"], "prompt": rec["prompt"], "want": want, "lux3d_ok": int(rec.get("ok", False)),
               "articulation_ok": 0, "robot": "", "random_pull": "", "joints": "", "note": rec.get("error", "")}
        if rec.get("ok"):
            page.goto(f"{base}/?base=/eval-objects/{d.name}/")
            page.wait_for_function("window.__robotproof && window.__robotproof.ready && window.__robotproof.id === 'shared'", timeout=90000)
            r = page.evaluate(SCRIPT, {"wantType": want, "seed": SEED})
            row["joints"] = " ".join(f"{j['name']}:{j['type']}" for j in r["joints"])
            row["articulation_ok"] = int(r["typesOk"] and r["pullOk"])
            if not r["typesOk"]:
                row["note"] = f"joint types {[j['type'] for j in r['joints']]} vs asked {want}"
            elif not r["pullOk"]:
                row["note"] = "a part did not open past half under a pull along its joint"
            if row["articulation_ok"]:
                row["robot"] = int(len(r["robotStumped"]) == 0)
                row["random_pull"] = int(len(r["baseStumped"]) == 0)
        rows.append(row)
        print(row["line"], row["prompt"][:40], "lux3d", row["lux3d_ok"], "art", row["articulation_ok"], "robot", row["robot"], "random", row["random_pull"], row["note"][:60], flush=True)
    browser.close()

with out_csv.open("w", newline="") as f:
    w = csv.DictWriter(f, fieldnames=list(rows[0].keys()))
    w.writeheader()
    w.writerows(rows)
n = len(rows)
k1 = sum(r["articulation_ok"] for r in rows)
both = [r for r in rows if r["articulation_ok"]]
print(f"n={n} articulation_ok={k1}/{n}; robot opened {sum(r['robot'] for r in both)}/{len(both)}; random pull opened {sum(r['random_pull'] for r in both)}/{len(both)}")
