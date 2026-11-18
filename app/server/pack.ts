// Turns Lux3D's articulation zip into a web-ready object folder: robot.urdf + compressed part meshes.
import { unzipSync } from 'fflate';
import { NodeIO } from '@gltf-transform/core';
import { ALL_EXTENSIONS } from '@gltf-transform/extensions';
import { dedup, prune, meshopt, textureCompress } from '@gltf-transform/functions';
import { MeshoptEncoder, MeshoptSimplifier, MeshoptDecoder } from 'meshoptimizer';
import sharp from 'sharp';

export interface PackedObject {
  files: { path: string; data: Uint8Array; type: string }[];
  urdf: string;
}

let io: NodeIO | null = null;
async function getIO() {
  if (io) return io;
  await Promise.all([MeshoptEncoder.ready, MeshoptSimplifier.ready, MeshoptDecoder.ready]);
  io = new NodeIO().registerExtensions(ALL_EXTENSIONS).registerDependencies({
    'meshopt.encoder': MeshoptEncoder,
    'meshopt.decoder': MeshoptDecoder,
  });
  return io;
}

export async function optimizeGlb(input: Uint8Array, textureSize = 1024): Promise<Uint8Array> {
  const nio = await getIO();
  const doc = await nio.readBinary(input);
  await doc.transform(
    dedup(),
    prune(),
    textureCompress({ encoder: sharp, targetFormat: 'webp', resize: [textureSize, textureSize] }),
    meshopt({ encoder: MeshoptEncoder, level: 'medium' }),
  );
  return nio.writeBinary(doc);
}

/** Unzip the articulation result, keep the URDF and its meshes, compress the meshes. */
export async function packArticulation(zip: Uint8Array): Promise<PackedObject> {
  const entries = unzipSync(zip);
  const names = Object.keys(entries);
  const urdfName = names.find((n) => n.toLowerCase().endsWith('.urdf'));
  if (!urdfName) throw new Error('The articulation result has no URDF file');
  const root = urdfName.slice(0, urdfName.lastIndexOf('/') + 1);
  const urdf = new TextDecoder().decode(entries[urdfName]);
  const files: PackedObject['files'] = [{ path: 'robot.urdf', data: entries[urdfName], type: 'application/xml' }];
  for (const n of names) {
    if (!n.startsWith(root) || !n.toLowerCase().endsWith('.glb')) continue;
    const rel = n.slice(root.length);
    files.push({ path: rel, data: await optimizeGlb(entries[n]), type: 'model/gltf-binary' });
  }
  if (files.length < 2) throw new Error('The articulation result has no part meshes');
  return { files, urdf };
}
