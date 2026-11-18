"""Loads a Robotproof download in MuJoCo (a real robot simulator) and drives every joint.

Usage: .venv/bin/python tests/sim_check.py <folder with robot.urdf>
Passes when the model compiles, has at least one hinge or slide joint, every link has a positive mass,
and pushing each joint opens it past half its range and it comes to rest at the same stop under a light
and a hard push, within 15% of the stated range (MuJoCo's URDF import places some stops slightly past
the URDF limit; a missing limit would let a hard push run on).
"""
import pathlib
import sys
import tempfile

import mujoco

folder = pathlib.Path(sys.argv[1])
urdf = (folder / "robot.urdf").read_text()
# MuJoCo looks for URDF meshes by file name in meshdir.
patched = urdf.replace(
    "</robot>",
    '<mujoco><compiler meshdir="meshes" balanceinertia="true" discardvisual="false" strippath="true"/></mujoco></robot>',
)
tmp = folder / "_mujoco.urdf"
tmp.write_text(patched)
model = mujoco.MjModel.from_xml_path(str(tmp))
data = mujoco.MjData(model)

moving = [j for j in range(model.njnt) if model.jnt_type[j] in (mujoco.mjtJoint.mjJNT_HINGE, mujoco.mjtJoint.mjJNT_SLIDE)]
assert moving, "no hinge or slide joints in the model"
masses = [float(model.body_mass[b]) for b in range(1, model.nbody)]
assert all(m > 0 for m in masses), f"a link has no mass: {masses}"

model.opt.gravity[:] = 0  # isolate the joint motion from gravity
report = []
for j in moving:
    lo, hi = model.jnt_range[j]
    limited = bool(model.jnt_limited[j])
    dof = model.jnt_dofadr[j]
    qadr = model.jnt_qposadr[j]
    sign = 1.0 if hi > 0 else -1.0
    stops = []
    for force in (0.5, 5.0):  # two different pushes: a real limit stops the part at the same place
        mujoco.mj_resetData(model, data)
        for _ in range(4000):
            data.qfrc_applied[:] = 0
            data.qfrc_applied[dof] = sign * force
            mujoco.mj_step(model, data)
        stops.append((float(data.qpos[qadr]), abs(float(data.qvel[dof]))))
    kind = "hinge" if model.jnt_type[j] == mujoco.mjtJoint.mjJNT_HINGE else "slide"
    name = mujoco.mj_id2name(model, mujoco.mjtObj.mjOBJ_JOINT, j)
    span = (hi - lo) if limited else 1.0
    q = stops[-1][0]
    frac = (q - lo) / span if limited else abs(q)
    still = all(v < 1e-3 for _, v in stops)
    same = abs(stops[0][0] - stops[1][0]) <= 0.02 * span
    inside = (not limited) or (lo - 0.15 * span <= q <= hi + 0.15 * span)
    ok = frac > 0.5 and still and same and inside
    report.append((name, ok))
    print(f"{name}: {kind} range [{lo:.3f}, {hi:.3f}] stops at {stops[0][0]:.3f} (light push) / {stops[1][0]:.3f} (hard push), at rest={still} -> {'ok' if ok else 'FAIL'}")
tmp.unlink()
if not all(ok for _, ok in report):
    sys.exit("MuJoCo: a joint did not move through its range")
print(f"MuJoCo {mujoco.__version__}: {len(moving)} joint(s) load and actuate; link masses {[round(m, 2) for m in masses]} kg")
