// POST /api/make  { prompt?: string, image?: dataURL, moves: string }
// Starts Lux3D generation. Returns { meshTask, moves } for the client to poll with /api/job.
import type { VercelRequest, VercelResponse } from '@vercel/node';
import { textTo3d, imageTo3d } from '../server/lux3d.js';
import { checkAndCount, putOnce } from '../server/store.js';

const PER_VISITOR = Number(process.env.MAX_PER_VISITOR_PER_DAY ?? 3);
const PER_DAY = Number(process.env.MAX_OBJECTS_PER_DAY ?? 60);

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Use POST' });
  try {
    const { prompt, image, moves } = (req.body ?? {}) as { prompt?: string; image?: string; moves?: string };
    const p = typeof prompt === 'string' ? prompt.trim().slice(0, 200) : '';
    const m = typeof moves === 'string' ? moves.trim().slice(0, 240) : '';
    if (!p && !image) return res.status(400).json({ error: 'Describe an object or add a photo.' });
    if (!m) return res.status(400).json({ error: 'Say what should open, for example "the lid opens upward".' });

    let imgUrl: string | undefined;
    if (image) {
      const match = /^data:(image\/(png|jpeg|webp));base64,(.+)$/.exec(image);
      if (!match) return res.status(400).json({ error: 'The photo must be a PNG, JPEG or WebP.' });
      const buf = Buffer.from(match[3], 'base64');
      if (buf.length > 4_000_000) return res.status(400).json({ error: 'The photo is over 4 MB. Try a smaller one.' });
      imgUrl = await putOnce(`uploads/${Date.now()}-${Math.random().toString(36).slice(2)}.${match[2] === 'jpeg' ? 'jpg' : match[2]}`, buf, match[1]);
    }

    const ip = String(req.headers['x-forwarded-for'] ?? req.socket.remoteAddress ?? 'unknown').split(',')[0].trim();
    const cap = await checkAndCount(ip, PER_VISITOR, PER_DAY);
    if (!cap.ok) return res.status(429).json({ error: cap.reason });

    const meshTask = imgUrl ? await imageTo3d(imgUrl) : await textTo3d(p);
    return res.status(200).json({ meshTask, moves: m, label: p || 'Your photo' });
  } catch (e: any) {
    console.error(e);
    return res.status(502).json({ error: `Lux3D couldn't start: ${e?.message ?? e}` });
  }
}
