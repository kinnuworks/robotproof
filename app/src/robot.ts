// The robot: tries to open each moving part using only what it can see (the part's shape and where it
// sits on the object). It is never given the joint type, axis or limits. It picks a grip point, tries a
// short list of generic moves with a capped pulling force, and reports what happened.
import * as THREE from 'three';
import type { World, Part } from './world';

export type Strategy = 'pull' | 'lift' | 'sweep-left' | 'sweep-right' | 'push-down' | 'copy';
export interface Attempt { part: string; strategy: Strategy; opened: number; success: boolean }
export interface RobotResult { attempts: Attempt[]; opened: string[]; stumped: string[] }

/** A person's demonstration on one part: where they grabbed it (in the part's own frame) and where that
 * point went, sampled while they dragged. No joint data: the same thing a camera on the person would see. */
export interface Demo { part: string; local: THREE.Vector3; path: THREE.Vector3[]; t: number[]; joint: number[] }

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
    default: return out;
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

  /** Learning from one demonstration: for each part with a demo, the robot grips where the person gripped
   * and moves its hand along the person's path (relative to where it started), with the same 60 N cap and
   * the same slip rule. It still never reads the joint. One try per part. */
  async imitate(demos: Map<string, Demo>, opts: RobotOptions = {}): Promise<RobotResult> {
    const o = this.world.object;
    if (!o) throw new Error('no object loaded');
    const strength = opts.strength ?? 60;
    const attempts: Attempt[] = [];
    const opened: string[] = [], stumped: string[] = [];
    for (const joint of o.joints) {
      const part = joint.child;
      const demo = demos.get(part.name);
      if (!demo || demo.path.length < 2) { stumped.push(part.name); continue; }
      this.reset();
      const grip0 = part.mesh.localToWorld(demo.local.clone());
      const start = demo.path[0];
      // Keep the moments of progress: the points where your hand was further from where it started than
      // ever before (a person's drag bounces; the robot copies the way out, not the wobble).
      const keys: THREE.Vector3[] = [start];
      let far = 0;
      for (const q of demo.path) {
        const d = q.distanceTo(start);
        if (d > far + 0.005) { far = d; keys.push(q); }
      }
      const path = keys;
      // Follow your path at a steady hand speed (at most 0.4 m/s), and only while the gripped point keeps
      // up (within 4 cm), as a tracking controller would; then hold the end for a second.
      const cum = [0];
      for (let i = 1; i < path.length; i++) cum.push(cum[i - 1] + path[i].distanceTo(path[i - 1]));
      const total = cum[cum.length - 1];
      const at = (d: number) => {
        let i = 1;
        while (i < cum.length - 1 && cum[i] < d) i++;
        const span = cum[i] - cum[i - 1] || 1;
        return path[i - 1].clone().lerp(path[i], Math.min(1, Math.max(0, (d - cum[i - 1]) / span)));
      };
      const ds = 0.4 * this.world.physics.timestep;
      const damp = 2 * Math.sqrt(400 * part.mass);
      let d = 0, settle = 0, stuck = 0;
      // stop when the end is held for a second, or when the part hasn't followed for 1.5 s (a stop, or stuck)
      for (let s = 0; s < 1200 && settle < 60 && stuck < 90; s++) {
        const hand = grip0.clone().add(at(d).sub(start));
        const p = part.mesh.localToWorld(demo.local.clone());
        if (p.distanceTo(hand) < 0.04) { d = Math.min(total, d + ds); stuck = 0; } else stuck++;
        if (d >= total) settle++;
        const v = part.body.linvel();
        // critically damped hand (no swing past the target); same 60 N cap as every other try
        const force = hand.clone().sub(p).multiplyScalar(400).sub(new THREE.Vector3(v.x, v.y, v.z).multiplyScalar(damp));
        if (force.length() > strength) force.setLength(strength);
        for (const q of o.parts) q.body.resetForces(true);
        part.body.addForceAtPoint({ x: force.x, y: force.y, z: force.z }, { x: p.x, y: p.y, z: p.z }, true);
        this.world.step(this.world.physics.timestep);
        if (hand.distanceTo(part.mesh.localToWorld(demo.local.clone())) > 0.12) {
          opts.onStep?.(hand, p, part, 'copying you (slipped)');
          break;
        }
        opts.onStep?.(hand, p, part, 'copying you');
        if (opts.frameDelay && s % 3 === 0) await new Promise((r) => setTimeout(r, opts.frameDelay! * 3));
      }
      const openness = this.world.openness(joint);
      const ok = openness >= 0.5;
      attempts.push({ part: part.name, strategy: 'copy' as Strategy, opened: +openness.toFixed(3), success: ok });
      (ok ? opened : stumped).push(part.name);
    }
    // leave the object as the robot left it, so the person sees the result
    return { attempts, opened, stumped };
  }
}
