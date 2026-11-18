"""Renders the downloaded chest in MuJoCo itself (closed, then with the lid driven open) into docs/mujoco-chest.png.

Usage: .venv/bin/python tests/mujoco_shot.py <folder with model.xml> <out png>
Proof for the README claim that the download loads and moves in MuJoCo: this is MuJoCo's own renderer,
not the browser.
"""
import pathlib
import sys

import mujoco
import numpy as np
import subprocess

folder, out = pathlib.Path(sys.argv[1]), pathlib.Path(sys.argv[2])
# The download is Y-up like the URDF; for the picture only, stand it upright (Z-up) and add a light and a floor.
xml = (folder / "model.xml").read_text()
xml = xml.replace("<worldbody>", '<worldbody><light pos="0.6 -1 2" dir="-0.3 0.5 -1" diffuse="0.9 0.9 0.9"/>'
                  '<geom type="plane" size="3 3 0.01" rgba="0.93 0.9 0.85 1"/><body name="upright" euler="1.5708 0 0">', 1)
xml = xml.replace("</worldbody>", "</body></worldbody>", 1)
tmp = folder / "_shot.xml"
tmp.write_text(xml)
model = mujoco.MjModel.from_xml_path(str(tmp))
tmp.unlink()
model.geom_rgba[1:] = [0.62, 0.42, 0.25, 1]
data = mujoco.MjData(model)
r = mujoco.Renderer(model, 480, 640)
cam = mujoco.MjvCamera()
mujoco.mjv_defaultFreeCamera(model, cam)
cam.azimuth, cam.elevation = 210, -18
cam.distance *= 0.75
cam.lookat[2] = 0.25

opt = mujoco.MjvOption()
opt.geomgroup[:] = 1  # the model's geoms are collision group 3, hidden by default

def shot():
    mujoco.mj_forward(model, data)
    r.update_scene(data, cam, opt)
    return r.render()

closed = shot()
j = next(i for i in range(model.njnt) if model.jnt_type[i] in (mujoco.mjtJoint.mjJNT_HINGE, mujoco.mjtJoint.mjJNT_SLIDE))
lo, hi = model.jnt_range[j]
data.qpos[model.jnt_qposadr[j]] = hi if abs(hi) >= abs(lo) else lo
opened = shot()
img = np.concatenate([closed, opened], axis=1)
ppm = out.with_suffix('.ppm')
ppm.write_bytes(f'P6 {img.shape[1]} {img.shape[0]} 255\n'.encode() + img.tobytes())
subprocess.run(['ffmpeg', '-y', '-loglevel', 'error', '-i', str(ppm), str(out)], check=True)
ppm.unlink()
print("mujoco", mujoco.__version__, "joint", mujoco.mj_id2name(model, mujoco.mjtObj.mjOBJ_JOINT, j), "range", lo, hi, "->", out)
