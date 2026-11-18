// Minimal URDF reader for the files Lux3D articulation returns:
// links with one visual mesh each, and revolute / prismatic / fixed joints.

export type Vec3 = [number, number, number];

export interface UrdfLink {
  name: string;
  mesh: string | null; // path relative to the URDF file
  mass: number;
}

export interface UrdfJoint {
  name: string;
  type: 'revolute' | 'prismatic' | 'continuous' | 'fixed' | string;
  parent: string;
  child: string;
  origin: Vec3;
  rpy: Vec3;
  axis: Vec3;
  lower: number;
  upper: number;
}

export interface Urdf {
  name: string;
  links: UrdfLink[];
  joints: UrdfJoint[];
}

function vec(s: string | null | undefined, fallback: Vec3): Vec3 {
  if (!s) return fallback;
  const p = s.trim().split(/\s+/).map(Number);
  return p.length === 3 && p.every(Number.isFinite) ? [p[0], p[1], p[2]] : fallback;
}

export function parseUrdf(xml: string): Urdf {
  const doc = new DOMParser().parseFromString(xml, 'application/xml');
  if (doc.querySelector('parsererror')) throw new Error('URDF is not valid XML');
  const robot = doc.querySelector('robot');
  if (!robot) throw new Error('URDF has no <robot> element');

  const links: UrdfLink[] = [...robot.querySelectorAll(':scope > link')].map((l) => ({
    name: l.getAttribute('name') ?? '',
    mesh: l.querySelector('visual mesh')?.getAttribute('filename') ?? null,
    mass: Number(l.querySelector('inertial mass')?.getAttribute('value') ?? '0') || 0,
  }));

  const joints: UrdfJoint[] = [...robot.querySelectorAll(':scope > joint')].map((j) => {
    const lim = j.querySelector('limit');
    return {
      name: j.getAttribute('name') ?? '',
      type: j.getAttribute('type') ?? 'fixed',
      parent: j.querySelector('parent')?.getAttribute('link') ?? '',
      child: j.querySelector('child')?.getAttribute('link') ?? '',
      origin: vec(j.querySelector('origin')?.getAttribute('xyz'), [0, 0, 0]),
      rpy: vec(j.querySelector('origin')?.getAttribute('rpy'), [0, 0, 0]),
      axis: vec(j.querySelector('axis')?.getAttribute('xyz'), [1, 0, 0]),
      lower: Number(lim?.getAttribute('lower') ?? '0'),
      upper: Number(lim?.getAttribute('upper') ?? '0'),
    };
  });

  return { name: robot.getAttribute('name') ?? 'object', links, joints };
}

/** The link no joint points to: the fixed base. */
export function rootLink(u: Urdf): string {
  const children = new Set(u.joints.map((j) => j.child));
  return u.links.find((l) => !children.has(l.name))?.name ?? u.links[0]?.name ?? '';
}
