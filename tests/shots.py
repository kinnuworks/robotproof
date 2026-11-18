"""Screenshots of the real app for the project report and README (no mock-ups).

Usage: python tests/shots.py <base url> <out dir> [extra base folder urls...]
"""
import pathlib
import sys

from playwright.sync_api import sync_playwright

base, out = sys.argv[1].rstrip("/"), pathlib.Path(sys.argv[2])
extra = sys.argv[3:]
out.mkdir(parents=True, exist_ok=True)

def ready(page, ident):
    page.wait_for_function(f"window.__robotproof && window.__robotproof.ready && window.__robotproof.id === '{ident}'", timeout=90000)
    page.wait_for_timeout(1500)

def canvas_shot(page, name):
    # clip by the canvas box: the stage keeps animating, so element screenshots never see it "stable"
    page.screenshot(path=str(out / f"{name}.png"), clip=page.locator("#view").bounding_box())

with sync_playwright() as p:
    b = p.chromium.launch(args=["--use-gl=swiftshader", "--enable-unsafe-swiftshader"])
    page = b.new_page(viewport={"width": 1280, "height": 760}, device_scale_factor=2)

    page.goto(base + "/?base=/report-raw/")
    ready(page, "shared")
    canvas_shot(page, "01-lux3d-model-one-piece")

    page.goto(base + "/?object=chest")
    ready(page, "chest")
    canvas_shot(page, "02-chest-closed")
    page.screenshot(path=str(out / "00-full-page.png"))
    page.evaluate("""() => { const {world} = window.__robotproof; const j = world.object.joints[0]; const b = j.child.body;
      for (let i = 0; i < 240; i++) { b.resetForces(true); b.addForceAtPoint({x:0,y:120,z:0},{x:0,y:0.45,z:0.17},true); world.physics.step(); }
      world.step(0); }""")
    page.wait_for_timeout(300)
    canvas_shot(page, "03-chest-lid-open-on-its-hinge")

    # robot mid-attempt: start a run and grab a frame part way through
    page.evaluate("() => { window.__robotproof.robot.reset(); document.querySelector('#robot').click(); }")
    page.wait_for_timeout(2500)
    canvas_shot(page, "04-robot-trying-the-lid")
    page.wait_for_function("document.querySelector('#robot').disabled === false && window.__robotproof.lastRun", timeout=240000)
    page.screenshot(path=str(out / "05-robot-verdict-chest.png"))

    page.select_option("#pick", "nightstand")
    ready(page, "nightstand")
    page.evaluate("""() => { const {world} = window.__robotproof;
      for (const j of world.object.joints) { const b = j.child.body; for (let i = 0; i < 240; i++) { b.resetForces(true); const m = j.child.mass * 15; b.addForce({x: j.axis.x*m, y: j.axis.y*m, z: j.axis.z*m}, true); world.physics.step(); } }
      world.step(0); }""")
    page.wait_for_timeout(300)
    canvas_shot(page, "06-nightstand-drawers-out")

    for i, eb in enumerate(extra):
        page.goto(base + "/?base=" + eb)
        ready(page, "shared")
        canvas_shot(page, f"07-visitor-object-{i + 1}-closed")
        page.evaluate("""() => { const {world} = window.__robotproof;
          for (const j of world.object.joints) { const b = j.child.body; const c = j.child.samples.reduce((a, v) => a.add(v), j.anchor.clone().set(0,0,0)).multiplyScalar(1 / j.child.samples.length);
            const dir = j.def.type === 'prismatic' ? j.axis.clone() : j.axis.clone().cross(c.clone().sub(j.anchor)).normalize();
            for (let k = 0; k < 360; k++) { b.resetForces(true); const f = dir.clone().multiplyScalar(j.child.mass * 20); b.addForceAtPoint({x:f.x,y:f.y,z:f.z},{x:c.x,y:c.y,z:c.z},true); world.physics.step(); } }
          world.step(0); }""")
        page.wait_for_timeout(300)
        canvas_shot(page, f"07-visitor-object-{i + 1}-opened")
    b.close()
print("shots in", out)
