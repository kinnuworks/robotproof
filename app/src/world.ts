// three.js scene + Rapier physics for one articulated object loaded from a URDF.
import * as THREE from 'three';
import RAPIER from '@dimforge/rapier3d-compat';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { MeshoptDecoder } from 'three/examples/jsm/libs/meshopt_decoder.module.js';
import { ConvexHull } from 'three/examples/jsm/math/ConvexHull.js';
import { parseUrdf, rootLink, type Urdf, type UrdfJoint } from './urdf';

export interface Part {
  name: string;
  mesh: THREE.Object3D;
  body: RAPIER.RigidBody;
  isRoot: boolean;
  /** Estimated mass in kg (shell estimate, see estimateMass). */
  mass: number;
  /** World-space vertices sampled from the visual mesh at rest, used by the robot's eyes. */
  samples: THREE.Vector3[];
  /** Pose at rest (closed). */
  rest: { position: THREE.Vector3; quaternion: THREE.Quaternion };
  shape: LinkShape;
}

export type LinkShape =
  | { kind: 'trimesh'; meshes: { verts: Float32Array; idx: Uint32Array }[] }
  | { kind: 'hull'; points: Float32Array };

export interface Joint {
  def: UrdfJoint;
  rapier: RAPIER.ImpulseJoint;
  parent: Part;
  child: Part;
  /** World-space anchor and axis at rest. */
  anchor: THREE.Vector3;
  axis: THREE.Vector3;
  /** Anchor in the parent's frame and axis in the child's frame, for rebuilding the joint. */
  a1: THREE.Vector3;
  axisLocal: THREE.Vector3;
}

export interface LoadedObject {
  urdf: Urdf;
  parts: Part[];
  joints: Joint[];
  root: Part;
  size: THREE.Vector3;
}

const loader = new GLTFLoader();
loader.setMeshoptDecoder(MeshoptDecoder);

let rapierReady: Promise<void> | null = null;
// Collision groups (membership << 16 | filter): object parts touch only the ground, never each other.
// Their joints and limits already hold them together; part-part contact pushed lids open on reset.
const GROUND = (0x0001 << 16) | 0xffff;
const PARTS = (0x0002 << 16) | 0x0001;
export function initPhysics() {
  rapierReady ??= RAPIER.init();
  return rapierReady;
}

/** Shell estimate: surface area × wall thickness × density (wood-like by default). Labelled an estimate in the UI. */
export function estimateMass(geoms: THREE.BufferGeometry[], thickness = 0.012, density = 600) {
  let area = 0;
  const a = new THREE.Vector3(), b = new THREE.Vector3(), c = new THREE.Vector3();
  for (const g of geoms) {
    const pos = g.getAttribute('position');
    const idx = g.getIndex();
    const tri = (i: number, j: number, k: number) => {
      a.fromBufferAttribute(pos, i); b.fromBufferAttribute(pos, j); c.fromBufferAttribute(pos, k);
      area += b.sub(a).cross(c.sub(a)).length() / 2;
    };
    if (idx) for (let i = 0; i < idx.count; i += 3) tri(idx.getX(i), idx.getX(i + 1), idx.getX(i + 2));
    else for (let i = 0; i < pos.count; i += 3) tri(i, i + 1, i + 2);
  }
  return Math.max(0.05, area * thickness * density);
}

function worldGeometries(obj: THREE.Object3D): THREE.BufferGeometry[] {
  obj.updateMatrixWorld(true);
  const out: THREE.BufferGeometry[] = [];
  obj.traverse((o) => {
    const m = o as THREE.Mesh;
    if (!m.isMesh) return;
    // Meshopt/quantized files store positions as normalized integers; rebuild plain floats first.
    const src = m.geometry.getAttribute('position');
    const pos = new Float32Array(src.count * 3);
    const v = new THREE.Vector3();
    for (let i = 0; i < src.count; i++) {
      v.fromBufferAttribute(src, i);
      pos[i * 3] = v.x; pos[i * 3 + 1] = v.y; pos[i * 3 + 2] = v.z;
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    const idx = m.geometry.getIndex();
    if (idx) g.setIndex(new THREE.BufferAttribute(Uint32Array.from(idx.array as ArrayLike<number>), 1));
    out.push(g.applyMatrix4(m.matrixWorld));
  });
  return out;
}

function sampleVertices(geoms: THREE.BufferGeometry[], max: number): THREE.Vector3[] {
  const all: THREE.Vector3[] = [];
  for (const g of geoms) {
    const p = g.getAttribute('position');
    for (let i = 0; i < p.count; i++) all.push(new THREE.Vector3().fromBufferAttribute(p, i));
  }
  if (all.length <= max) return all;
  const step = all.length / max;
  const out: THREE.Vector3[] = [];
  for (let i = 0; i < max; i++) out.push(all[Math.floor(i * step)]);
  return out;
}

export class World {
  scene = new THREE.Scene();
  physics!: RAPIER.World;
  object: LoadedObject | null = null;
  private meshToPart = new Map<THREE.Object3D, Part>();
  private group = new THREE.Group();

  async init() {
    await initPhysics();
    this.physics = new RAPIER.World({ x: 0, y: -9.81, z: 0 });
    this.physics.timestep = 1 / 120;
    this.physics.numSolverIterations = 12;
    this.scene.add(this.group);
    const hemi = new THREE.HemisphereLight(0xffffff, 0x8a8a8a, 1.6);
    const dir = new THREE.DirectionalLight(0xffffff, 2.2);
    dir.position.set(1.5, 3, 2);
    dir.castShadow = true;
    dir.shadow.mapSize.set(2048, 2048);
    this.scene.add(hemi, dir);
    const ground = new THREE.Mesh(new THREE.CircleGeometry(4, 64), new THREE.ShadowMaterial({ opacity: 0.18 }));
    ground.rotation.x = -Math.PI / 2;
    ground.receiveShadow = true;
    this.scene.add(ground);
    this.physics.createCollider(RAPIER.ColliderDesc.cuboid(4, 0.05, 4).setTranslation(0, -0.05, 0).setCollisionGroups(GROUND));
  }

  partOf(o: THREE.Object3D | null): Part | undefined {
    for (let x = o; x; x = x.parent) {
      const p = this.meshToPart.get(x);
      if (p) return p;
    }
    return undefined;
  }

  clear() {
    if (!this.object) return;
    for (const j of this.object.joints) this.physics.removeImpulseJoint(j.rapier, true);
    for (const p of this.object.parts) this.physics.removeRigidBody(p.body);
    this.group.clear();
    this.meshToPart.clear();
    this.object = null;
  }

  /** Load a URDF and its part meshes from a base URL (the folder that holds robot.urdf). */
  async load(baseUrl: string): Promise<LoadedObject> {
    this.clear();
    const base = baseUrl.replace(/\/?$/, '/');
    const xml = await (await fetch(base + 'robot.urdf')).text();
    const urdf = parseUrdf(xml);
    const rootName = rootLink(urdf);

    // Link world transforms at rest (joint value 0): parent * origin.
    const linkWorld = new Map<string, THREE.Matrix4>([[rootName, new THREE.Matrix4()]]);
    const pending = [...urdf.joints];
    for (let guard = 0; pending.length && guard < 50; guard++) {
      for (let i = pending.length - 1; i >= 0; i--) {
        const j = pending[i];
        const pm = linkWorld.get(j.parent);
        if (!pm) continue;
        const local = new THREE.Matrix4().compose(
          new THREE.Vector3(...j.origin),
          new THREE.Quaternion().setFromEuler(new THREE.Euler(j.rpy[0], j.rpy[1], j.rpy[2], 'ZYX')),
          new THREE.Vector3(1, 1, 1),
        );
        linkWorld.set(j.child, pm.clone().multiply(local));
        pending.splice(i, 1);
      }
    }

    const parts: Part[] = [];
    await Promise.all(urdf.links.map(async (l) => {
      const holder = new THREE.Group();
      if (l.mesh) {
        const gltf = await loader.loadAsync(base + l.mesh);
        gltf.scene.traverse((o) => {
          const m = o as THREE.Mesh;
          if (m.isMesh) { m.castShadow = true; m.receiveShadow = true; }
        });
        holder.add(gltf.scene);
      }
      const mw = linkWorld.get(l.name) ?? new THREE.Matrix4();
      const pos = new THREE.Vector3(), quat = new THREE.Quaternion(), scl = new THREE.Vector3();
      mw.decompose(pos, quat, scl);
      holder.position.copy(pos);
      holder.quaternion.copy(quat);
      this.group.add(holder);

      const isRoot = l.name === rootName;
      const geomsWorld = worldGeometries(holder);
      const mass = estimateMass(geomsWorld);
      // Collider data in the link's local frame (kept so physics can be rebuilt at rest).
      const inv = mw.clone().invert();
      const localGeoms = geomsWorld.map((g) => g.clone().applyMatrix4(inv));
      const shape: LinkShape = isRoot
        ? { kind: 'trimesh', meshes: localGeoms.map((g) => {
            const verts = g.getAttribute('position').array as Float32Array;
            const n = verts.length / 3;
            const idx = g.index ? (g.index.array as Uint32Array) : Uint32Array.from({ length: n }, (_, i) => i);
            return { verts, idx };
          }).filter((m) => m.verts.length >= 9 && m.idx.length >= 3) }
        : (() => {
            const hull = new ConvexHull().setFromPoints(sampleVertices(localGeoms, 2000));
            const hv: number[] = [];
            for (const v of hull.vertices) hv.push(v.point.x, v.point.y, v.point.z);
            return { kind: 'hull' as const, points: new Float32Array(hv) };
          })();
      const body = null as unknown as RAPIER.RigidBody;
      const part: Part = { name: l.name, mesh: holder, body, isRoot, mass, samples: sampleVertices(geomsWorld, 1500), rest: { position: pos.clone(), quaternion: quat.clone() }, shape };
      holder.traverse((o) => this.meshToPart.set(o, part));
      parts.push(part);
    }));

    const byName = new Map(parts.map((p) => [p.name, p]));
    const joints: Joint[] = [];
    for (const j of urdf.joints) {
      const parent = byName.get(j.parent), child = byName.get(j.child);
      if (!parent || !child) continue;
      const pw = linkWorld.get(j.parent)!;
      const cw = linkWorld.get(j.child)!;
      const anchorWorld = new THREE.Vector3().setFromMatrixPosition(cw);
      const a1 = anchorWorld.clone().applyMatrix4(pw.clone().invert());
      const axisLocal = new THREE.Vector3(...j.axis).normalize();
      const axisWorld = axisLocal.clone().transformDirection(cw);
      joints.push({ def: j, rapier: null as unknown as RAPIER.ImpulseJoint, parent, child, anchor: anchorWorld, axis: axisWorld, a1, axisLocal });
    }
    this.object = { urdf, parts, joints, root: byName.get(rootName)!, size: new THREE.Vector3() };
    this.buildPhysics();
    const box = new THREE.Box3().setFromObject(this.group);
    const size = box.getSize(new THREE.Vector3());
    this.object.size = size;
    return this.object;
  }

  /** Create (or re-create) every rigid body, collider and joint at the rest pose. */
  buildPhysics() {
    const o = this.object;
    if (!o) return;
    for (const j of o.joints) if (j.rapier) this.physics.removeImpulseJoint(j.rapier, true);
    for (const p of o.parts) if (p.body) this.physics.removeRigidBody(p.body);
    for (const p of o.parts) {
      const { position: pos, quaternion: quat } = p.rest;
      const desc = (p.isRoot ? RAPIER.RigidBodyDesc.fixed() : RAPIER.RigidBodyDesc.dynamic())
        .setTranslation(pos.x, pos.y, pos.z)
        .setRotation({ x: quat.x, y: quat.y, z: quat.z, w: quat.w })
        .setAngularDamping(p.isRoot ? 0 : 1.5)
        .setLinearDamping(p.isRoot ? 0 : 1.5)
        .setCanSleep(false);
      p.body = this.physics.createRigidBody(desc);
      if (p.shape.kind === 'trimesh') {
        for (const m of p.shape.meshes) this.physics.createCollider(RAPIER.ColliderDesc.trimesh(m.verts, m.idx).setFriction(0.8).setCollisionGroups(PARTS), p.body);
      } else {
        const d = RAPIER.ColliderDesc.convexHull(p.shape.points) ?? RAPIER.ColliderDesc.ball(0.05);
        d.setMass(p.mass).setFriction(0.8).setCollisionGroups(PARTS);
        this.physics.createCollider(d, p.body);
      }
      p.mesh.position.copy(pos);
      p.mesh.quaternion.copy(quat);
    }
    for (const j of o.joints) {
      let data: RAPIER.JointData;
      if (j.def.type === 'prismatic') data = RAPIER.JointData.prismatic(j.a1, { x: 0, y: 0, z: 0 }, j.axisLocal);
      else if (j.def.type === 'revolute' || j.def.type === 'continuous') data = RAPIER.JointData.revolute(j.a1, { x: 0, y: 0, z: 0 }, j.axisLocal);
      else data = RAPIER.JointData.fixed(j.a1, { w: 1, x: 0, y: 0, z: 0 }, { x: 0, y: 0, z: 0 }, { w: 1, x: 0, y: 0, z: 0 });
      if (j.def.type === 'revolute' || j.def.type === 'prismatic') { data.limitsEnabled = true; data.limits = [j.def.lower, j.def.upper]; }
      const rj = this.physics.createImpulseJoint(data, j.parent.body, j.child.body, true);
      rj.setContactsEnabled(false);
      if (j.def.type === 'revolute' || j.def.type === 'prismatic') (rj as RAPIER.RevoluteImpulseJoint).setLimits(j.def.lower, j.def.upper);
      // A little friction in the joint so parts stay where you leave them.
      if (j.def.type !== 'fixed') (rj as RAPIER.RevoluteImpulseJoint).configureMotorVelocity(0, j.child.mass * 0.6);
      j.rapier = rj;
    }
  }

  /** Current joint value (radians or metres) measured from the bodies, relative to rest. */
  jointValue(j: Joint): number {
    const cb = j.child.body, pb = j.parent.body;
    const cq = new THREE.Quaternion(cb.rotation().x, cb.rotation().y, cb.rotation().z, cb.rotation().w);
    const pq = new THREE.Quaternion(pb.rotation().x, pb.rotation().y, pb.rotation().z, pb.rotation().w);
    if (j.def.type === 'prismatic') {
      const cp = new THREE.Vector3(cb.translation().x, cb.translation().y, cb.translation().z);
      return cp.sub(j.anchor).dot(j.axis.clone().applyQuaternion(pq));
    }
    const rel = pq.clone().invert().multiply(cq);
    const angle = 2 * Math.acos(Math.min(1, Math.abs(rel.w)));
    const sign = Math.sign(new THREE.Vector3(rel.x, rel.y, rel.z).dot(new THREE.Vector3(...j.def.axis))) || 1;
    return angle * sign;
  }

  /** 0 = closed, 1 = fully open, using the URDF limits. */
  openness(j: Joint): number {
    const span = j.def.upper - j.def.lower || 1;
    return Math.max(0, Math.min(1, (this.jointValue(j) - j.def.lower) / span));
  }

  step(dt: number) {
    const n = Math.max(1, Math.round(dt / this.physics.timestep));
    for (let i = 0; i < Math.min(n, 30); i++) this.physics.step();
    if (!this.object) return;
    for (const p of this.object.parts) {
      const t = p.body.translation(), r = p.body.rotation();
      p.mesh.position.set(t.x, t.y, t.z);
      p.mesh.quaternion.set(r.x, r.y, r.z, r.w);
    }
  }
}
