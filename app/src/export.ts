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

export function urdfWithPhysics(xml: string, obj: LoadedObject): string {
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
    // Collision = the visual mesh, so simulators that need collision geometry can load it.
    if (!link.querySelector('collision')) {
      const vis = link.querySelector('visual geometry');
      if (vis) {
        const col = doc.createElement('collision');
        col.appendChild(vis.cloneNode(true));
        link.appendChild(col);
      }
    }
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

export async function buildZip(base: string, obj: LoadedObject, name: string): Promise<Blob> {
  const b = base.replace(/\/?$/, '/');
  const xml = await (await fetch(b + 'robot.urdf')).text();
  // Point the URDF at OBJ meshes (readable by MuJoCo, PyBullet, Isaac); the textured GLBs ride along.
  const objXml = xml.replace(/filename="([^"]+)\.glb"/g, 'filename="$1.obj"');
  const files: Record<string, Uint8Array> = { [`${name}/robot.urdf`]: strToU8(urdfWithPhysics(objXml, obj)) };
  for (const l of obj.urdf.links) {
    if (!l.mesh) continue;
    files[`${name}/${l.mesh}`] = new Uint8Array(await (await fetch(b + l.mesh)).arrayBuffer());
    files[`${name}/${l.mesh.replace(/\.glb$/, '.obj')}`] = strToU8(partObj(obj, l.name));
  }
  return new Blob([zipSync(files, { level: 0 }) as Uint8Array<ArrayBuffer>], { type: 'application/zip' });
}
