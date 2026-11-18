"""Walks the demo path in a real (headless) Chromium against the built site, and records a video.

Usage: python tests/e2e.py <base url> <out dir>
1. The chest loads; a person drags its lid open past half its range with the mouse.
2. The robot tries the chest; the run ends with a verdict.
3. If the robot was stumped, "teach" makes it copy the person's drag (grip point and path, no joint data) and it opens the lid.
4. The download button gives a zip with robot.urdf and meshes (checked further by sim_check.py) and the person's demonstration.
"""
import json
import pathlib
import sys
import zipfile

from playwright.sync_api import sync_playwright

base, out = sys.argv[1].rstrip("/"), pathlib.Path(sys.argv[2])
out.mkdir(parents=True, exist_ok=True)
results = {}

with sync_playwright() as p:
    browser = p.chromium.launch(args=["--use-gl=swiftshader", "--enable-unsafe-swiftshader"])
    ctx = browser.new_context(viewport={"width": 1280, "height": 760}, record_video_dir=str(out / "video"), accept_downloads=True)
    page = ctx.new_page()
    errors = []
    page.on("pageerror", lambda e: errors.append(str(e)))
    page.goto(base + "/?object=chest")
    page.wait_for_function("window.__robotproof && window.__robotproof.ready && window.__robotproof.id === 'chest'", timeout=60000)
    page.wait_for_timeout(1500)

    # 1. Drag the lid: find the lid's front-top point on screen and pull it up and back.
    pts = page.evaluate("""() => {
      const {world, camera, canvas} = window.__robotproof;
      const lid = world.object.parts.find(p => !p.isRoot);
      let mx=-1e9, mz=-1e9, nz=1e9; for (const v of lid.samples) { mx=Math.max(mx,v.y); mz=Math.max(mz,v.z); nz=Math.min(nz,v.z); }
      const s = (x,y,z) => { const q = lid.samples[0].clone().set(x,y,z).project(camera); const r = canvas.getBoundingClientRect();
        return [r.left + (q.x+1)/2*r.width, r.top + (1-q.y)/2*r.height]; };
      return { a: s(0, mx-0.03, mz-0.01), b: s(0, mx+0.35, nz) };
    }""")
    page.mouse.move(*pts["a"])
    page.mouse.down()
    for i in range(1, 31):
        t = i / 30
        page.mouse.move(pts["a"][0] + (pts["b"][0] - pts["a"][0]) * t, pts["a"][1] + (pts["b"][1] - pts["a"][1]) * t)
        page.wait_for_timeout(35)
    page.wait_for_timeout(700)
    opened = page.evaluate("() => { const {world} = window.__robotproof; return world.openness(world.object.joints[0]); }")
    page.mouse.up()
    you = page.inner_text("#you")
    results["human_drag_openness"] = round(opened, 3)
    assert opened >= 0.5, f"dragging the lid only opened it {opened:.2f}"
    assert "You opened" in you, f"no 'you opened' message: {you!r}"

    # 2. Robot on the chest (the demo path).
    for obj in ["chest"]:
        if obj != "chest":
            page.select_option("#pick", obj)
            page.wait_for_function(f"window.__robotproof.id === '{obj}'", timeout=60000)
            page.wait_for_timeout(1000)
        page.click("#robot")
        page.wait_for_function("document.querySelector('#robot').disabled === false && window.__robotproof.lastRun", timeout=240000)
        run = page.evaluate("() => { const r = window.__robotproof.lastRun; window.__robotproof.lastRun = null; return r; }")
        verdict = page.inner_text("#verdict")
        results[f"robot_{obj}"] = {"opened": run["opened"], "stumped": run["stumped"], "verdict": verdict}
        assert verdict.startswith("STUMPED") or verdict.startswith("The robot opened"), verdict
        page.screenshot(path=str(out / f"{obj}-after-robot.png"))

        # 3. Teach: the robot copies the person's demonstration (grip point and hand path), still capped at 60 N.
        if run["stumped"]:
            page.wait_for_selector("#teach:not([hidden])", timeout=10000)
            page.click("#teach")
            page.wait_for_function("window.__robotproof.lastTeach", timeout=240000)
            teach = page.evaluate("() => window.__robotproof.lastTeach")
            results[f"teach_{obj}"] = {"opened": teach["opened"], "stumped": teach["stumped"], "verdict": page.inner_text("#verdict")}
            assert "lid" in teach["opened"], f"the robot didn't open the lid from the demonstration: {teach}"
            page.screenshot(path=str(out / f"{obj}-after-teach.png"))

    # 4. Download for simulators.
    with page.expect_download(timeout=60000) as dl:
        page.click("#download")
    zpath = out / "download.zip"
    dl.value.save_as(zpath)
    with zipfile.ZipFile(zpath) as z:
        names = z.namelist()
        z.extractall(out / "download")
    assert any(n.endswith("robot.urdf") for n in names), names
    assert any(n.endswith(".obj") for n in names), names
    results["download_files"] = names
    demo_name = next((n for n in names if n.endswith("demonstrations.json")), None)
    assert demo_name, f"no demonstrations.json in the download: {names}"
    demo = json.loads((out / "download" / demo_name).read_text())
    d0 = demo["demonstrations"][0]
    assert d0["link"] == "lid" and len(d0["samples"]) >= 10, d0.keys()
    assert max(s["joint_fraction"] for s in d0["samples"]) >= 0.5, "the recorded demonstration never opened the lid past half"
    results["demonstration_samples"] = len(d0["samples"])
    results["page_errors"] = errors
    ctx.close()
    browser.close()

assert not results["page_errors"], results["page_errors"]
(out / "e2e.json").write_text(json.dumps(results, indent=1))
print(json.dumps(results, indent=1))
