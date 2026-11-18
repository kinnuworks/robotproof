// GET  /api/gallery            -> objects people made, newest first, with robot results
// POST /api/gallery {id, human, robot} -> records one try (write-once file per try)
import type { VercelRequest, VercelResponse } from '@vercel/node';
import { listAll, putOnce } from '../server/store.js';

const ID = /^\d{1,15}$/;

export default async function handler(req: VercelRequest, res: VercelResponse) {
  try {
    if (req.method === 'POST') {
      const { id, human, robot } = (req.body ?? {}) as { id?: string; human?: boolean; robot?: { opened?: string[]; stumped?: string[] } };
      if (!id || !ID.test(String(id))) return res.status(400).json({ error: 'Bad id' });
      const clean = (a: unknown) => (Array.isArray(a) ? a.filter((x) => typeof x === 'string').slice(0, 12).map((x) => x.slice(0, 40)) : []);
      const rec = { human: !!human, opened: clean(robot?.opened), stumped: clean(robot?.stumped), at: new Date().toISOString() };
      await putOnce(`results/${id}/${Date.now()}-${Math.random().toString(36).slice(2, 7)}.json`, JSON.stringify(rec), 'application/json');
      return res.json({ ok: true });
    }
    res.setHeader('Cache-Control', 's-maxage=15, stale-while-revalidate=60');
    const metas = (await listAll('objects/')).filter((b) => b.pathname.endsWith('/meta.json'));
    const results = await listAll('results/');
    const items = await Promise.all(metas.map(async (m) => {
      const meta = await (await fetch(m.url)).json();
      const mine = results.filter((r) => r.pathname.startsWith(`results/${meta.id}/`));
      let stumped = 0, opened = 0;
      for (const r of mine.slice(-20)) {
        const rec = await (await fetch(r.url)).json();
        if (rec.stumped?.length) stumped++; else if (rec.opened?.length) opened++;
      }
      return { ...meta, base: m.url.replace(/meta\.json$/, ''), tries: mine.length, stumped, opened };
    }));
    items.sort((a, b) => String(b.at).localeCompare(String(a.at)));
    return res.json({ items });
  } catch (e: any) {
    console.error(e);
    return res.status(502).json({ error: String(e?.message ?? e) });
  }
}
