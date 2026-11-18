// Evidence step 1: generate the test slice (lines 3-30 of evidence/data/prompts-v1.txt) through the same
// Lux3D calls and packing the live site uses, and keep every result (or failure) in evidence/data/objects/.
// Run: cd app && npx tsx ../evidence/generate.mts   (needs AHOLO_API_KEY in the environment)
import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { textTo3d, articulate, getTask } from '../app/server/lux3d.ts';
import { packArticulation } from '../app/server/pack.ts';

const root = new URL('.', import.meta.url).pathname;
const lines = readFileSync(root + 'data/prompts-v1.txt', 'utf8').split('\n').filter((l) => l.trim() && !l.startsWith('#'));
const slice = lines.slice(2); // test slice: lines 3-30 (the first two were used while building)
const CONCURRENCY = Number(process.env.CONCURRENCY ?? 4);
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function wait(task: string, label: string) {
  for (let i = 0; i < 180; i++) {
    const t = await getTask(task).catch(() => ({ status: -1, outputs: [] as string[], error: 'poll error' }));
    if (t.status === 3) return t;
    if (t.status === 4 || t.status === 6) throw new Error(`${label} failed: ${t.error ?? 'no reason given'}`);
    await sleep(10000);
  }
  throw new Error(`${label} timed out after 30 min`);
}

async function one(i: number, line: string) {
  const n = String(i + 3).padStart(2, '0');
  const dir = `${root}data/objects/${n}/`;
  if (existsSync(dir + 'result.json')) return;
  mkdirSync(dir, { recursive: true });
  const [prompt, moves] = line.split('|').map((s) => s.trim());
  const rec: any = { line: i + 3, prompt, moves, started: new Date().toISOString() };
  try {
    rec.meshTask = await textTo3d(prompt);
    const mesh = await wait(rec.meshTask, 'mesh');
    rec.glbUrl = mesh.outputs.find((u) => u.endsWith('.glb')) ?? mesh.outputs[0];
    rec.artTask = await articulate(rec.glbUrl, moves);
    const art = await wait(rec.artTask, 'articulation');
    const zip = new Uint8Array(await (await fetch(art.outputs[0], { signal: AbortSignal.timeout(180000) })).arrayBuffer());
    const packed = await packArticulation(zip);
    for (const f of packed.files) {
      mkdirSync((dir + f.path).replace(/[^/]+$/, ''), { recursive: true });
      writeFileSync(dir + f.path, f.data);
    }
    rec.joints = [...packed.urdf.matchAll(/<joint[^>]*type="(\w+)"/g)].map((m) => m[1]).filter((x) => x !== 'fixed');
    rec.ok = true;
  } catch (e: any) {
    rec.ok = false;
    rec.error = String(e?.message ?? e);
  }
  rec.finished = new Date().toISOString();
  writeFileSync(dir + 'result.json', JSON.stringify(rec, null, 1));
  console.log(n, rec.ok ? `ok ${rec.joints}` : `FAILED ${rec.error}`, prompt);
}

const queue = slice.map((l, i) => () => one(i, l));
await Promise.all(Array.from({ length: CONCURRENCY }, async () => { while (queue.length) await queue.shift()!(); }));
console.log('done');
