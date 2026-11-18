// Server-side Aholo (international) client. The key comes from the AHOLO_API_KEY environment variable
// and never reaches the browser.
import { createAssetClient } from '@manycore/aholo-sdk-asset';

const BASE = 'https://api.aholo.ai/global';

/** Upload a photo to Aholo's own asset storage (the URL Lux3D image-to-3D can always fetch). */
export async function uploadImage(data: Buffer, filename: string): Promise<string> {
  const asset = createAssetClient({ region: 'com', apiKey: key() });
  const r = await asset.uploadBuffer(data, { filename });
  return r.url;
}

function key(): string {
  const k = process.env.AHOLO_API_KEY;
  if (!k) throw new Error('AHOLO_API_KEY is not set on the server');
  return k;
}

async function call(method: string, path: string, body?: unknown, params?: Record<string, string>) {
  const url = new URL(BASE + path);
  for (const [k, v] of Object.entries(params ?? {})) url.searchParams.set(k, v);
  const res = await fetch(url, {
    method,
    headers: { Authorization: key(), Accept: 'application/json', 'Content-Type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await res.text();
  let json: any;
  try { json = JSON.parse(text); } catch { throw new Error(`Aholo returned ${res.status}: ${text.slice(0, 200)}`); }
  if (!res.ok || (json.c && json.c !== '0')) {
    throw new Error(`Aholo ${path} failed (${res.status} ${json.c ?? ''}): ${json.m ?? text.slice(0, 200)}`);
  }
  return json.d;
}

export interface TaskState { status: number; outputs: string[]; error?: string }

/** Lux3D task status: 0 init, 1 running, 3 succeeded, 4 failed, 6 cancelled. */
export async function getTask(taskId: string | number): Promise<TaskState> {
  const d = await call('GET', '/lux3d/v1/generate/task/get', undefined, { taskid: String(taskId) });
  const outputs = (d?.outputs ?? []).map((o: any) => String(o?.content ?? '')).filter(Boolean);
  let error: string | undefined;
  if (d?.status === 4) {
    try { error = JSON.parse(outputs[0] ?? '{}')?.error?.message; } catch { error = outputs[0]; }
  }
  return { status: Number(d?.status), outputs, error };
}

export async function textTo3d(prompt: string): Promise<string> {
  const d = await call('POST', '/lux3d/v1/generate/text-to-3d/task/create', {
    prompt, version: 'G1-Turbo', faceCount: 60000, outputFormat: ['glb'],
  });
  return String(d);
}

export async function imageTo3d(imgUrl: string): Promise<string> {
  const d = await call('POST', '/lux3d/v1/generate/img-to-3d/task/create', {
    img: imgUrl, version: 'G1-Turbo', faceCount: 60000, outputFormat: ['glb'],
  });
  return String(d);
}

export async function articulate(glbUrl: string, prompt: string): Promise<string> {
  const d = await call('POST', '/lux3d/v1/articulation-animation/task/create', { glbUrl, prompt });
  return String(d);
}

export async function balance(): Promise<number> {
  const d = await call('GET', '/lux3d/v1/account/balance', undefined, { source: '2' });
  return Number(d?.availableCredits ?? 0);
}
