// The robot: tries to open each moving part using only what it can see (the part's shape and where it
// sits on the object). It is never given the joint type, axis or limits. It picks a grip point, tries a
// short list of generic moves with a capped pulling force, and reports what happened.
import * as THREE from 'three';
import type { World, Part } from './world';

export type Strategy = 'pull' | 'lift' | 'sweep-left' | 'sweep-right' | 'push-down';
export interface Attempt { part: string; strategy: Strategy; opened: number; success: boolean }
export interface RobotResult { attempts: Attempt[]; opened: string[]; stumped: string[] }

/** Deterministic pseudo-random numbers so a run can be repeated exactly. */
export function rng(seed: number) {
  let s = seed >>> 0;
  return () => ((s = (s * 1664525 + 1013904223) >>> 0) / 2 ** 32);
}

function bbox(points: THREE.Vector3[]) {
  return new THREE.Box3().setFromPoints(points);
}

/** Where the robot would grab a part: the point that sticks out furthest from the object's centre,
 * preferring the front-and-top, like a handle or the lip of a lid. Shape only. */
export function gripPoint(part: Part, root: Part): THREE.Vector3 {
  const rc = bbox(root.samples).getCenter(new THREE.Vector3());
  const pc = bbox(part.samples).getCenter(new THREE.Vector3());
  const out = pc.clone().sub(rc).setY(0);
  if (out.lengthSq() < 1e-6) out.set(0, 0, 1);
  out.normalize();
  let best = part.samples[0], score = -Infinity;
  for (const v of part.samples) {
    const d = v.clone().sub(rc);
    const sc = d.dot(out) + 0.35 * d.y;
    if (sc > score) { score = sc; best = v; }
  }
  return best.clone();
}

/** The robot's ranked guesses, from shape alone. */
export function plan(part: Part, root: Part): Strategy[] {
  const rb = bbox(root.samples), pb = bbox(part.samples);
  const ps = pb.getSize(new THREE.Vector3());
  const onTop = pb.min.y > rb.min.y + 0.6 * (rb.max.y - rb.min.y);
  const flat = ps.y < 0.6 * Math.max(ps.x, ps.z);
  const first: Strategy = onTop && flat ? 'lift' : 'pull';
  const rest: Strategy[] = (['pull', 'lift', 'sweep-left', 'sweep-right', 'push-down'] as Strategy[]).filter((s) => s !== first);
  return [first, ...rest].slice(0, 3);
}

function direction(s: Strategy, part: Part, root: Part): THREE.Vector3 {
  const rc = bbox(root.samples).getCenter(new THREE.Vector3());
  const pc = bbox(part.samples).getCenter(new THREE.Vector3());
  const out = pc.clone().sub(rc).setY(0);
  if (out.lengthSq() < 1e-6) out.set(0, 0, 1);
  out.normalize();
  const side = new THREE.Vector3(0, 1, 0).cross(out).normalize();
  switch (s) {
    case 'pull': return out;
    case 'lift': return new THREE.Vector3(0, 1, 0).addScaledVector(out, 0.25).normalize();
    case 'sweep-left': return side.clone().addScaledVector(out, 0.5).normalize();
    case 'sweep-right': return side.clone().negate().addScaledVector(out, 0.5).normalize();
    case 'push-down': return new THREE.Vector3(0, -1, 0);
  }
}

export interface RobotOptions {
  /** Max force the gripper can apply, newtons. */
  strength?: number;
  /** How far the hand travels per attempt, metres. */
  reach?: number;
  seed?: number;
  /** Override the plan (used by the random-pull baseline). */
  strategyFor?: (part: Part, i: number) => { strategy: Strategy | 'random'; dir?: THREE.Vector3; grip?: THREE.Vector3 };
  /** Called every physics step so the page can draw the arm. */
  onStep?: (hand: THREE.Vector3, grip: THREE.Vector3, part: Part, strategy: string) => void;
  /** Wait between steps (ms); 0 runs as fast as possible (tests). */
  frameDelay?: number;
}

export class Robot {
  private world: World;
  constructor(world: World) { this.world = world; }

  /** Put every moving part back to rest (closed) before a try. Teleporting bodies doesn't stick in
   * the joint solver, so the object's physics is rebuilt at its rest pose instead. */
  reset() {
    this.world.buildPhysics();
    this.world.step(0);
  }

  async run(opts: RobotOptions = {}): Promise<RobotResult> {
    const o = this.world.object;
    if (!o) throw new Error('no object loaded');
    const strength = opts.strength ?? 60;
    const reach = opts.reach ?? 0.45;
    const rand = rng(opts.seed ?? 20261118);
    const attempts: Attempt[] = [];
    const opened: string[] = [], stumped: string[] = [];

    for (const joint of o.joints) {
      const part = joint.child;
      const tries = plan(part, o.root);
      let ok = false;
      for (let i = 0; i < 3 && !ok; i++) {
        this.reset();
        const custom = opts.strategyFor?.(part, i);
        let strategy: Strategy | 'random' = custom?.strategy ?? tries[i];
        const grip0 = (custom?.grip ?? gripPoint(part, o.root)).clone();
        // a little hand jitter, as a real gripper would have
        grip0.add(new THREE.Vector3(rand() - 0.5, rand() - 0.5, rand() - 0.5).multiplyScalar(0.01));
        const dir = custom?.dir ?? direction(strategy as Strategy, part, o.root);
        // the grip point in the part's own frame, so it moves with the part
        const local = part.mesh.worldToLocal(grip0.clone());
        const steps = 180;
        for (let s = 0; s <= steps; s++) {
          const t = s / steps;
          const hand = grip0.clone().addScaledVector(dir, reach * Math.min(1, t * 1.2));
          const p = part.mesh.localToWorld(local.clone());
          const v = part.body.linvel();
          const f = hand.clone().sub(p).multiplyScalar(400).sub(new THREE.Vector3(v.x, v.y, v.z).multiplyScalar(20));
          if (f.length() > strength) f.setLength(strength);
          for (const q of o.parts) q.body.resetForces(true);
          part.body.addForceAtPoint({ x: f.x, y: f.y, z: f.z }, { x: p.x, y: p.y, z: p.z }, true);
          this.world.step(this.world.physics.timestep);
          // The grip slips if the hand gets too far from the part: it can't hold on to a part that won't move.
          if (hand.distanceTo(part.mesh.localToWorld(local.clone())) > 0.12) {
            opts.onStep?.(hand, p, part, strategy + ' (slipped)');
            break;
          }
          opts.onStep?.(hand, p, part, strategy);
          if (opts.frameDelay && s % 3 === 0) await new Promise((r) => setTimeout(r, opts.frameDelay! * 3));
        }
        const openness = this.world.openness(joint);
        ok = openness >= 0.5;
        attempts.push({ part: part.name, strategy: strategy as Strategy, opened: +openness.toFixed(3), success: ok });
      }
      (ok ? opened : stumped).push(part.name);
    }
    this.reset();
    return { attempts, opened, stumped };
  }
}
