"""Makes one object on the live site through the real form (Lux3D model, then articulation) and records it:
a screen video, screenshots of each stage and the timings. Spends real credits (about 13 + 28) and one of
the visitor's daily objects.

Usage: python tests/make_live.py <base url> <out dir> "<what is it>" "<what should open>"
Writes <out dir>/make.json (stage timings, the object's id and joints) and stage screenshots.
"""
import json
import pathlib
import sys
import time

from playwright.sync_api import sync_playwright

base, out = sys.argv[1].rstrip("/"), pathlib.Path(sys.argv[2])
what, moves = sys.argv[3], sys.argv[4]
out.mkdir(parents=True, exist_ok=True)
log = {"what": what, "moves": moves, "stages": []}

with sync_playwright() as p:
    b = p.chromium.launch(args=["--use-gl=swiftshader", "--enable-unsafe-swiftshader"])
    ctx = b.new_context(viewport={"width": 1280, "height": 800}, record_video_dir=str(out / "video"))
    page = ctx.new_page()
    page.goto(base + "/?object=chest")
    page.wait_for_function("window.__robotproof && window.__robotproof.ready", timeout=90000)
    page.locator("#make-panel").scroll_into_view_if_needed()
    page.fill("#what", what)
    page.fill("#moves", moves)
    t0 = time.time()
    page.click("#make button[type=submit]")
    page.screenshot(path=str(out / "make-0-sent.png"))
    last = ""
    shot = 1
    while time.time() - t0 < 25 * 60:
        txt = page.inner_text("#progress")
        stage = txt.split(" ")[0:3]
        key = " ".join(stage)
        if key != last:
            log["stages"].append({"t_s": round(time.time() - t0), "text": txt})
            print(round(time.time() - t0), txt, flush=True)
            page.screenshot(path=str(out / f"make-{shot}.png"))
            shot += 1
            last = key
        if txt.startswith("Ready in") or txt.startswith("That didn't work") or "limit" in txt:
            break
        page.wait_for_timeout(5000)
    log["total_s"] = round(time.time() - t0)
    log["final"] = page.inner_text("#progress")
    if log["final"].startswith("Ready in"):
        page.wait_for_function("window.__robotproof && window.__robotproof.ready", timeout=120000)
        page.wait_for_timeout(2000)
        log["id"] = page.evaluate("window.__robotproof.id")
        log["joints"] = page.evaluate("window.__robotproof.world.object.joints.map(j => ({name: j.def.name, type: j.def.type, lower: j.def.lower, upper: j.def.upper}))")
        page.evaluate("window.scrollTo(0, 0)")
        page.screenshot(path=str(out / "make-ready.png"))
    ctx.close()
    b.close()

(out / "make.json").write_text(json.dumps(log, indent=1))
print(json.dumps(log, indent=1))
