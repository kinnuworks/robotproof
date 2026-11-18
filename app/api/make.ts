// POST /api/make  { prompt?: string, image?: dataURL, photoUrl?: string, moves: string }
// Starts Lux3D generation. Returns { meshTask, moves } for the client to poll with /api/job.
// When Lux3D's concurrent-task limit is reached it answers 503 { busy: true, photoUrl } and the client
// retries a little later with photoUrl (no second upload). The daily cap counts only objects that started.
import type { VercelRequest, VercelResponse } from '@vercel/node';
import { textTo3d, imageTo3d, uploadImage } from '../server/lux3d.js';
import { checkCap, countOne } from '../server/store.js';

const PER_VISITOR = Number(process.env.MAX_PER_VISITOR_PER_DAY ?? 3);
const PER_DAY = Number(process.env.MAX_OBJECTS_PER_DAY ?? 60);
const AHOLO_PHOTO = /^https:\/\/[a-z0-9.-]+\.(aholo3d\.cn|aholo\.ai|kujiale\.com)\/[^\s"']+$/;

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Use POST' });
  try {
    const { prompt, image, photoUrl, moves } = (req.body ?? {}) as { prompt?: string; image?: string; photoUrl?: string; moves?: string };
    const p = typeof prompt === 'string' ? prompt.trim().slice(0, 200) : '';
    const m = typeof moves === 'string' ? moves.trim().slice(0, 240) : '';
    if (!p && !image && !photoUrl) return res.status(400).json({ error: 'Describe an object or add a photo.' });
    if (!m) return res.status(400).json({ error: 'Say what should open, for example "the lid opens upward".' });

    const ip = String(req.headers['x-forwarded-for'] ?? req.socket.remoteAddress ?? 'unknown').split(',')[0].trim();
    const cap = await checkCap(ip, PER_VISITOR, PER_DAY);
    if (!cap.ok) return res.status(429).json({ error: cap.reason });

    let imgUrl: string | undefined;
    if (photoUrl) {
      if (!AHOLO_PHOTO.test(photoUrl)) return res.status(400).json({ error: 'Bad photo link' });
      imgUrl = photoUrl;
    } else if (image) {
      const match = /^data:(image\/(png|jpeg|webp));base64,(.+)$/.exec(image);
      if (!match) return res.status(400).json({ error: 'The photo must be a PNG, JPEG or WebP.' });
      const buf = Buffer.from(match[3], 'base64');
      if (buf.length > 4_000_000) return res.status(400).json({ error: 'The photo is over 4 MB. Try a smaller one.' });
      // Lux3D fetches photos reliably only from Aholo's own storage, so upload there first.
      imgUrl = await uploadImage(buf, `photo-${Date.now()}.${match[2] === 'jpeg' ? 'jpg' : match[2]}`);
    }

    let meshTask: string;
    try {
      meshTask = imgUrl ? await imageTo3d(imgUrl) : await textTo3d(p);
    } catch (e: any) {
      if (/CONCURRENCY_LIMIT/.test(String(e?.message))) {
        return res.status(503).json({ busy: true, photoUrl: imgUrl, error: 'Lux3D is busy with other objects right now. Waiting for a free slot…' });
      }
      throw e;
    }
    await countOne(ip);
    console.log(`make: task ${meshTask} ${imgUrl ? 'photo ' + imgUrl : 'text'}`);
    return res.status(200).json({ meshTask, moves: m, label: p || 'Your photo', ...(imgUrl ? { photo: imgUrl } : {}) });
  } catch (e: any) {
    console.error(e);
    return res.status(502).json({ error: `Lux3D couldn't start: ${e?.message ?? e}` });
  }
}
