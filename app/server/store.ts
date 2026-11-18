// Vercel Blob helpers. Everything is written once (never overwritten), so CDN caching can't serve stale state.
import { put, head, list } from '@vercel/blob';
import { createHash } from 'node:crypto';

export async function exists(pathname: string): Promise<string | null> {
  try {
    const h = await head(pathname);
    return h.url;
  } catch {
    return null;
  }
}

export async function putOnce(pathname: string, data: Buffer | Uint8Array | string, contentType: string) {
  const r = await put(pathname, Buffer.from(data as any), {
    access: 'public', addRandomSuffix: false, contentType, cacheControlMaxAge: 31536000,
  });
  return r.url;
}

export async function listAll(prefix: string) {
  const out: { pathname: string; url: string; uploadedAt: Date }[] = [];
  let cursor: string | undefined;
  do {
    const r = await list({ prefix, cursor, limit: 1000 });
    out.push(...r.blobs.map((b) => ({ pathname: b.pathname, url: b.url, uploadedAt: b.uploadedAt })));
    cursor = r.hasMore ? r.cursor : undefined;
  } while (cursor);
  return out;
}

export function hashIp(ip: string) {
  return createHash('sha256').update('robotproof:' + ip).digest('hex').slice(0, 16);
}

/** Daily caps on new objects: per visitor and overall. Each object that starts leaves a marker file. */
export async function checkCap(ip: string, perVisitor: number, perDay: number) {
  const day = new Date().toISOString().slice(0, 10);
  const all = await listAll(`limits/${day}/`);
  const mine = all.filter((b) => b.pathname.startsWith(`limits/${day}/${hashIp(ip)}-`)).length;
  if (all.length >= perDay) return { ok: false, reason: `Today's limit of ${perDay} new objects is used up. Try the gallery, or come back tomorrow.` };
  if (mine >= perVisitor) return { ok: false, reason: `You've made ${perVisitor} objects today, the most one visitor can make. Try the gallery while you wait.` };
  return { ok: true as const };
}

export async function countOne(ip: string) {
  const day = new Date().toISOString().slice(0, 10);
  await putOnce(`limits/${day}/${hashIp(ip)}-${Date.now()}`, '1', 'text/plain');
}
