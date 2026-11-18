// Builds a downloadable zip: robot.urdf with estimated mass and inertia per link (instead of Lux3D's
// 1.0 kg placeholders), plus the part meshes. Mass is a shell estimate (area × 12 mm × 600 kg/m³),
// labelled as an estimate inside the file.
import * as THREE from 'three';
import { zipSync, strToU8 } from 'fflate';
import type { LoadedObject } from './world';

function boxInertia(m: number, s: THREE.Vector3) {
  return {
    ixx: (m / 12) * (s.y * s.y + s.z * s.z),
    iyy: (m / 12) * (s.x * s.x + s.z * s.z),
    izz: (m / 12) * (s.x * s.x + s.y * s.y),
  };
}

export function urdfWithPhysics(xml: string, obj: LoadedObject, pieces: Record<string, number> = {}): string {
  const doc = new DOMParser().parseFromString(xml, 'application/xml');
  for (const link of doc.querySelectorAll('robot > link')) {
    const part = obj.parts.find((p) => p.name === link.getAttribute('name'));
    if (!part) continue;
    const size = new THREE.Box3().setFromPoints(part.samples).getSize(new THREE.Vector3());
    let inertial = link.querySelector('inertial');
    if (!inertial) { inertial = doc.createElement('inertial'); link.appendChild(inertial); }
    inertial.innerHTML = '';
    const mass = doc.createElement('mass');
    mass.setAttribute('value', part.mass.toFixed(3));
    const I = boxInertia(part.mass, size);
    const inertia = doc.createElement('inertia');
    for (const [k, v] of Object.entries({ ixx: I.ixx, iyy: I.iyy, izz: I.izz, ixy: 0, ixz: 0, iyz: 0 })) inertia.setAttribute(k, v.toPrecision(4));
    inertial.append(mass, inertia);
    // Collision: simulators turn each collision mesh into its convex hull, which would make a hollow body
    // (a chest, a cabinet) solid and lock its lid or doors. The fixed body gets a grid of convex pieces.
    const name = link.getAttribute('name')!;
    if (!link.querySelector('collision') && pieces[name]) {
      for (let i = 0; i < pieces[name]; i++) {
        const col = doc.createElement('collision');
        const geo = doc.createElement('geometry');
        const mesh = doc.createElement('mesh');
        mesh.setAttribute('filename', `meshes/${name}_collision_${i}.obj`);
        geo.appendChild(mesh);
        col.appendChild(geo);
        link.appendChild(col);
      }
    } else if (!link.querySelector('collision')) {
      const vis = link.querySelector('visual geometry');
      if (vis) {
        const col = doc.createElement('collision');
        col.appendChild(vis.cloneNode(true));
        link.appendChild(col);
      }
    }
  }
  // Mount the object on a root link with a fixed joint. Simulators that weld the root link to the world
  // (MuJoCo does) would otherwise let its collision shape touch the moving parts at the seams.
  const robot = doc.documentElement;
  const firstLink = doc.querySelector('robot > link');
  const children = new Set([...doc.querySelectorAll('robot > joint > child')].map((c) => c.getAttribute('link')));
  const rootName = [...doc.querySelectorAll('robot > link')].map((l) => l.getAttribute('name')).find((n) => n && !children.has(n));
  if (rootName && rootName !== 'mount') {
    const mount = doc.createElement('link');
    mount.setAttribute('name', 'mount');
    const fixed = doc.createElement('joint');
    fixed.setAttribute('name', 'mount_to_' + rootName);
    fixed.setAttribute('type', 'fixed');
    const par = doc.createElement('parent'); par.setAttribute('link', 'mount');
    const chi = doc.createElement('child'); chi.setAttribute('link', rootName);
    fixed.append(par, chi);
    robot.insertBefore(mount, firstLink);
    robot.insertBefore(fixed, firstLink);
  }
  const comment = doc.createComment(
    ' Made with Robotproof from Aholo Lux3D output. Masses and inertias are estimates (surface area x 12 mm wall x 600 kg/m3, box inertia), not measurements. ',
  );
  doc.documentElement.insertBefore(comment, doc.documentElement.firstChild);
  return new XMLSerializer().serializeToString(doc);
}

/** Plain OBJ (positions + triangles) of a part, in its own link frame at rest. Simulators like MuJoCo read OBJ, not GLB. */
export function partObj(obj: LoadedObject, linkName: string): string {
  const part = obj.parts.find((p) => p.name === linkName);
  if (!part) return '';
  const inv = new THREE.Matrix4().compose(part.rest.position, part.rest.quaternion, new THREE.Vector3(1, 1, 1)).invert();
  const lines: string[] = ['# Robotproof part mesh (link frame, metres)'];
  let base = 1;
  const v = new THREE.Vector3();
  part.mesh.updateMatrixWorld(true);
  // Use the rest pose: undo the part's current transform, apply the rest one.
  const now = part.mesh.matrixWorld.clone();
  part.mesh.traverse((o) => {
    const m = o as THREE.Mesh;
    if (!m.isMesh) return;
    const toLink = inv.clone().multiply(new THREE.Matrix4().compose(part.rest.position, part.rest.quaternion, new THREE.Vector3(1, 1, 1))).multiply(now.clone().invert()).multiply(m.matrixWorld);
    const pos = m.geometry.getAttribute('position');
    for (let i = 0; i < pos.count; i++) {
      v.fromBufferAttribute(pos, i).applyMatrix4(toLink);
      lines.push(`v ${v.x.toFixed(5)} ${v.y.toFixed(5)} ${v.z.toFixed(5)}`);
    }
    const idx = m.geometry.getIndex();
    const n = idx ? idx.count : pos.count;
    for (let i = 0; i < n; i += 3) {
      const a = (idx ? idx.getX(i) : i) + base, b2 = (idx ? idx.getX(i + 1) : i + 1) + base, c = (idx ? idx.getX(i + 2) : i + 2) + base;
      lines.push(`f ${a} ${b2} ${c}`);
    }
    base += pos.count;
  });
  return lines.join('\n') + '\n';
}

/** The part's triangles in its link frame, split into a grid of cells; one OBJ per non-empty cell. */
export function collisionPieces(obj: LoadedObject, linkName: string, grid = 3): string[] {
  const part = obj.parts.find((p) => p.name === linkName);
  if (!part) return [];
  part.mesh.updateMatrixWorld(true);
  const now = part.mesh.matrixWorld.clone().invert();
  const tris: THREE.Vector3[][] = [];
  part.mesh.traverse((o) => {
    const m = o as THREE.Mesh;
    if (!m.isMesh) return;
    const toLink = now.clone().multiply(m.matrixWorld);
    const pos = m.geometry.getAttribute('position');
    const idx = m.geometry.getIndex();
    const n = idx ? idx.count : pos.count;
    for (let i = 0; i < n; i += 3) {
      const t = [0, 1, 2].map((k) => new THREE.Vector3().fromBufferAttribute(pos, idx ? idx.getX(i + k) : i + k).applyMatrix4(toLink));
      tris.push(t);
    }
  });
  const box = new THREE.Box3();
  tris.forEach((t) => t.forEach((v) => box.expandByPoint(v)));
  const size = box.getSize(new THREE.Vector3());
  const cells = new Map<string, THREE.Vector3[][]>();
  for (const t of tris) {
    const c = t[0].clone().add(t[1]).add(t[2]).divideScalar(3).sub(box.min);
    const key = ['x', 'y', 'z'].map((a) => Math.min(grid - 1, Math.floor(((c as any)[a] / Math.max(1e-6, (size as any)[a])) * grid))).join(',');
    if (!cells.has(key)) cells.set(key, []);
    cells.get(key)!.push(t);
  }
  const out: string[] = [];
  for (const list of cells.values()) {
    if (list.length < 4) continue;
    const lines = ['# Robotproof collision piece (link frame, metres)'];
    list.forEach((t) => t.forEach((v) => lines.push(`v ${v.x.toFixed(5)} ${v.y.toFixed(5)} ${v.z.toFixed(5)}`)));
    for (let i = 0; i < list.length; i++) lines.push(`f ${i * 3 + 1} ${i * 3 + 2} ${i * 3 + 3}`);
    out.push(lines.join('\n') + '\n');
  }
  return out;
}

/** A native MuJoCo model of the same object: same joints, limits and masses, collision pieces, and contact
 * excluded between each moving part and its parent (URDF has no way to say that). */
export function mjcf(obj: LoadedObject, pieces: Record<string, number>, meshFile: (link: string) => string): string {
  const f = (n: number) => n.toFixed(5);
  const assets: string[] = [];
  const geomsFor = (name: string) => {
    const g: string[] = [];
    if (pieces[name]) {
      for (let i = 0; i < pieces[name]; i++) {
        assets.push(`<mesh name="${name}_c${i}" file="${name}_collision_${i}.obj"/>`);
        g.push(`<geom type="mesh" mesh="${name}_c${i}" group="3"/>`);
      }
    } else {
      assets.push(`<mesh name="${name}_c" file="${meshFile(name)}"/>`);
      g.push(`<geom type="mesh" mesh="${name}_c" group="3"/>`);
    }
    return g.join('');
  };
  const inertial = (name: string) => {
    const p = obj.parts.find((q) => q.name === name)!;
    const b = new THREE.Box3().setFromPoints(p.samples);
    const c = b.getCenter(new THREE.Vector3()).sub(p.rest.position);
    const I = boxInertia(p.mass, b.getSize(new THREE.Vector3()));
    return `<inertial pos="${f(c.x)} ${f(c.y)} ${f(c.z)}" mass="${p.mass.toFixed(3)}" diaginertia="${I.ixx.toPrecision(4)} ${I.iyy.toPrecision(4)} ${I.izz.toPrecision(4)}"/>`;
  };
  const kids = (parent: string): string => obj.joints.filter((j) => j.parent.name === parent).map((j) => {
    const name = j.child.name;
    const o = j.def.origin, a = j.def.axis;
    const type = j.def.type === 'prismatic' ? 'slide' : 'hinge';
    const range = j.def.type === 'continuous' ? '' : ` range="${f(j.def.lower)} ${f(j.def.upper)}" limited="true"`;
    return `<body name="${name}" pos="${f(o[0])} ${f(o[1])} ${f(o[2])}">${inertial(name)}<joint name="${j.def.name}" type="${type}" axis="${f(a[0])} ${f(a[1])} ${f(a[2])}"${range} damping="0.05"/>${geomsFor(name)}${kids(name)}</body>`;
  }).join('');
  const root = obj.root.name;
  const tree = `<body name="${root}" pos="0 0 0">${inertial(root)}${geomsFor(root)}${kids(root)}</body>`;
  const excludes = obj.joints.map((j) => `<exclude body1="${j.parent.name}" body2="${j.child.name}"/>`).join('');
  return `<mujoco model="robotproof">
  <!-- Made with Robotproof from Aholo Lux3D output. Y is up (as in the URDF). Masses and inertias are estimates. -->
  <compiler meshdir="meshes" angle="radian"/>
  <option gravity="0 -9.81 0"/>
  <asset>${assets.join('')}</asset>
  <worldbody>${tree}</worldbody>
  <contact>${excludes}</contact>
</mujoco>
`;
}

export interface DemoLike { part: string; local: { x: number; y: number; z: number }; path: { x: number; y: number; z: number }[]; t: number[]; joint: number[] }

/** A person's drags as demonstrations: grip point in the link frame, then that point's world position and
 * the joint's open fraction over time. Same frame and units as robot.urdf (metres, Y up). */
export function demonstrationsJson(name: string, demos: DemoLike[]) {
  const r = (v: number) => +v.toFixed(4);
  return JSON.stringify({
    object: name,
    note: 'Recorded in Robotproof from a person dragging the part open with a mouse in browser physics (Rapier). Frame and units match robot.urdf: metres, Y up. joint_fraction is 0 closed to 1 at the joint limit.',
    demonstrations: demos.map((d) => ({
      link: d.part,
      grip_in_link_frame: [r(d.local.x), r(d.local.y), r(d.local.z)],
      samples: d.path.map((p, i) => ({ t: d.t[i], grip_world: [r(p.x), r(p.y), r(p.z)], joint_fraction: d.joint[i] })),
    })),
  }, null, 1);
}

export async function buildZip(base: string, obj: LoadedObject, name: string, demos: DemoLike[] = []): Promise<Blob> {
  const b = base.replace(/\/?$/, '/');
  const xml = await (await fetch(b + 'robot.urdf')).text();
  // Point the URDF at OBJ meshes (readable by MuJoCo, PyBullet, Isaac); the textured GLBs ride along.
  const objXml = xml.replace(/filename="([^"]+)\.glb"/g, 'filename="$1.obj"');
  const files: Record<string, Uint8Array> = {};
  const pieces: Record<string, number> = {};
  for (const p of obj.parts) {
    if (!p.isRoot) continue;
    const objs = collisionPieces(obj, p.name, 3);
    objs.forEach((o, i) => { files[`${name}/meshes/${p.name}_collision_${i}.obj`] = strToU8(o); });
    pieces[p.name] = objs.length;
  }
  files[`${name}/robot.urdf`] = strToU8(urdfWithPhysics(objXml, obj, pieces));
  files[`${name}/model.xml`] = strToU8(mjcf(obj, pieces, (link) => (obj.urdf.links.find((l) => l.name === link)?.mesh ?? '').replace(/^meshes\//, '').replace(/\.glb$/, '.obj')));
  for (const l of obj.urdf.links) {
    if (!l.mesh) continue;
    files[`${name}/${l.mesh}`] = new Uint8Array(await (await fetch(b + l.mesh)).arrayBuffer());
    files[`${name}/${l.mesh.replace(/\.glb$/, '.obj')}`] = strToU8(partObj(obj, l.name));
  }
  if (demos.length) files[`${name}/demonstrations.json`] = strToU8(demonstrationsJson(name, demos));
  return new Blob([zipSync(files, { level: 0 }) as Uint8Array<ArrayBuffer>], { type: 'application/zip' });
}
