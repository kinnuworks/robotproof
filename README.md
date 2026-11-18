# Robotproof

**Make something robots can't open.** Photograph or describe anything with a lid, a door or a drawer. Aholo Lux3D builds it in 3D and works out how its parts move. You open it with your mouse, then a robot arm tries, without being told how it opens.

It needs Lux3D because Lux3D's articulation step returns real joints (a URDF with hinge or slide axes, limits and separate part meshes), not just a mesh. Those joints drive the physics you drag, the robot's attempts and the file you download.

**Live:** https://robotproof.vercel.app

**Try it in 30 seconds**
1. Open the link. A wooden chest is already loaded.
2. Drag the front of the lid upward. It swings open on its hinge.
3. Press **Let the robot try**. It gets three attempts and doesn't know where the hinge is.
4. Switch to the nightstand: the robot pulls both drawers out. Download either object for a robot simulator.

---

## How it uses Aholo Lux3D

| Lux3D feature | What it does here | Code |
|---|---|---|
| Text-to-3D and image-to-3D (G1-Turbo, 60k faces) | turns your sentence or photo into a textured model | [app/server/lux3d.ts](app/server/lux3d.ts), [app/api/make.ts](app/api/make.ts) |
| Articulation (`articulation-animation`) | takes the model and one sentence ("the lid swings up on its back hinge") and returns a URDF: part meshes, joint type, axis, limits | [app/api/job.ts](app/api/job.ts) |
| The returned URDF | becomes rigid bodies and hinge or slide joints with the same limits in browser physics (Rapier) | [app/src/urdf.ts](app/src/urdf.ts), [app/src/world.ts](app/src/world.ts) |

Lux3D's own part masses are 1.0 kg placeholders. Robotproof replaces them with an estimate (surface area × 12 mm wall × 600 kg/m³) and says so inside the downloaded file.

## How the robot decides

The robot is not given the joint. It sees the shape of each moving part and where it sits on the object, picks the point that sticks out most (a knob, the lip of a lid), and tries up to three moves in the order the shape suggests: lift, pull, sweep left, sweep right or push down. Its grip is a held point with a 60 N cap, and it slips if the part won't follow. An attempt counts if the part ends up more than half open. It is a scripted set of moves on a drawn arm, not a learned policy. [app/src/robot.ts](app/src/robot.ts)

## Check it yourself

- The live app: https://robotproof.vercel.app (chest, nightstand, and anything visitors have made)
- `./check.sh` runs the typecheck, the build, a call to the real Aholo API, a headless browser run of the demo path (drag, robot, download, with video), and loads the downloaded URDF in MuJoCo 3.3.7 and drives every joint.

## What doesn't work yet

- A new object takes about 5 to 10 minutes: Lux3D builds the model (about 2 to 5 minutes), then finds the joints (about 4 to 5 minutes).
- Joint ranges can be off. A pencil box we asked to "slide out the full length" came back with ±3.4 cm of travel.
- Masses are estimates, not measurements, and the robot is a scripted grasp, not a trained controller.
- To keep credits for everyone, each visitor can make 3 objects a day, and the site makes at most 60 a day.
