// GET /api/job?mesh=<taskId>&moves=<sentence>&label=<text>
// Moves one object through: mesh (Lux3D) -> joints (Lux3D articulation) -> packed (compressed, stored).
// State lives in Lux3D task ids plus write-once Blob files, so it is safe to poll from many tabs.
import type { VercelRequest, VercelResponse } from '@vercel/node';
import { getTask, articulate } from '../server/lux3d.js';
import { packArticulation } from '../server/pack.js';
import { exists, putOnce } from '../server/store.js';

export const config = { maxDuration: 300 };

const ID = /^\d{1,15}$/;

export default async function handler(req: VercelRequest, res: VercelResponse) {
  const mesh = String(req.query.mesh ?? '');
  const moves = String(req.query.moves ?? '').slice(0, 240);
  const label = String(req.query.label ?? '').slice(0, 200);
  if (!ID.test(mesh)) return res.status(400).json({ error: 'Bad task id' });
  res.setHeader('Cache-Control', 'no-store');
  try {
    // Already finished?
    const doneUrl = await exists(`objects/${mesh}/meta.json`);
    if (doneUrl) return res.json({ stage: 'done', base: doneUrl.replace(/meta\.json$/, ''), id: mesh });

    // Articulation already started for this mesh?
    const artMarker = await exists(`arts/${mesh}.json`);
    if (!artMarker) {
      const t = await getTask(mesh);
      if (t.status === 4 || t.status === 6) return res.json({ stage: 'failed', error: t.error ?? 'Lux3D could not build this object. Try a clearer photo or description.' });
      if (t.status !== 3) return res.json({ stage: 'mesh' });
      if (!moves) return res.status(400).json({ error: 'Missing the sentence about what opens' });
      const glbUrl = t.outputs.find((u) => u.endsWith('.glb')) ?? t.outputs[0];
      let artTask: string;
      try {
        artTask = await articulate(glbUrl, moves);
      } catch (e: any) {
        if (/CONCURRENCY_LIMIT/.test(String(e?.message))) return res.json({ stage: 'waiting' });
        throw e;
      }
      await putOnce(`arts/${mesh}.json`, JSON.stringify({ artTask, glbUrl, moves, label, at: new Date().toISOString() }), 'application/json');
      return res.json({ stage: 'joints' });
    }

    const art = await (await fetch(artMarker)).json();
    const t = await getTask(art.artTask);
    if (t.status === 4 || t.status === 6) return res.json({ stage: 'failed', error: t.error ?? 'Lux3D could not work out the moving parts. Try saying more clearly what should open.' });
    if (t.status !== 3) return res.json({ stage: 'joints' });

    // Pack once. Another poll may be packing at the same time; the write-once files make that harmless.
    const t0 = Date.now();
    const zres = await fetch(t.outputs[0], { signal: AbortSignal.timeout(120000) });
    const zip = new Uint8Array(await zres.arrayBuffer());
    console.log(`job ${mesh}: zip ${zip.length} bytes in ${Date.now() - t0} ms`);
    const packed = await packArticulation(zip);
    console.log(`job ${mesh}: packed ${packed.files.length} files in ${Date.now() - t0} ms`);
    let base = '';
    for (const f of packed.files) {
      const url = await putOnce(`objects/${mesh}/${f.path}`, f.data, f.type);
      if (f.path === 'robot.urdf') base = url.replace(/robot\.urdf$/, '');
    }
    console.log(`job ${mesh}: stored in ${Date.now() - t0} ms`);
    const joints = [...packed.urdf.matchAll(/<joint[^>]*type="(\w+)"/g)].map((m) => m[1]).filter((x) => x !== 'fixed');
    await putOnce(`objects/${mesh}/meta.json`, JSON.stringify({
      id: mesh, label: art.label || label, moves: art.moves, joints, sourceGlb: art.glbUrl, at: new Date().toISOString(),
    }), 'application/json');
    return res.json({ stage: 'done', base, id: mesh });
  } catch (e: any) {
    console.error(e);
    return res.status(502).json({ stage: 'error', error: String(e?.message ?? e) });
  }
}
