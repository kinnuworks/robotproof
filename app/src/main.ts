import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { World, type Part } from './world';
import { Robot, type Demo } from './robot';
import { buildZip } from './export';
import { Arm } from './arm';
import './design/base.css';
import './design/components.css';
import './style.css';
import './design/theme.css';

interface Entry { key: string; label: string; base: string; id?: string; stumped?: number; tries?: number }

const BUILT_IN: Entry[] = [
  { key: 'chest', label: 'Wooden chest', base: '/objects/chest/' },
  { key: 'nightstand', label: 'Two-drawer nightstand', base: '/objects/nightstand/' },
];
let entries: Entry[] = [...BUILT_IN];
let current: Entry | null = null;

const app = document.querySelector<HTMLDivElement>('#app')!;
app.innerHTML = `
  <header class="bar">
    <a class="brand" href="/">Robotproof</a>
    <nav class="bar__links" aria-label="Sections">
      <a href="#film" id="film-open">Watch the film</a>
      <a href="#gym-panel">Robot Gym</a>
      <a href="#make-panel" class="bar__cta">Make your own</a>
    </nav>
  </header>
  <div class="cutouts" aria-hidden="true"><span class="cutouts__word"></span><img src="/design/cutouts.png" alt="" /></div>
  <dialog class="film" id="film" aria-label="The 94-second film">
    <video id="film-video" controls playsinline preload="none" poster="https://qhuaqity4gffgh3y.public.blob.vercel-storage.com/film/robotproof-poster.png" src="https://qhuaqity4gffgh3y.public.blob.vercel-storage.com/film/robotproof-film.mp4"></video>
    <form method="dialog"><button class="ui-btn">Close</button></form>
  </dialog>
  <main class="bench">
    <section class="stage">
      <canvas id="view" aria-label="3D view of the object. Drag a lid or drawer to open it."></canvas>
      <div class="intro">
        <h1>Make something robots can't open.</h1>
        <p class="why">Photograph or describe anything with a lid, a door or a drawer. Lux3D builds it with working hinges. You open it first. Then the robot tries, without being told how. Stump it, then show it once and see if it learns.</p>
      </div>
      <div class="hint" id="hint">Drag a lid or drawer to open it</div>
      <p class="caption" id="caption" aria-hidden="true" hidden></p>
      <div class="stamp" id="stamp" aria-hidden="true" hidden></div>
      <div class="banner" id="banner" hidden></div>
    </section>
    <aside class="rail">
      <section class="panel panel--turn">
        <div class="pickrow">
          <label for="pick">Object</label>
          <select id="pick"></select>
        </div>
        <h2>Moving parts</h2>
        <ul id="joints"></ul>
        <ol class="duel">
          <li class="duel__row duel__row--you"><span class="duel__who">You</span><p class="you" id="you"></p></li>
          <li class="duel__row duel__row--robot"><span class="duel__who">Robot</span>
            <div class="duel__body">
              <button id="robot" type="button" class="ui-btn robot-btn">Let the robot try</button>
              <p class="verdict" id="verdict" role="status"></p>
              <ol id="attempts"></ol>
              <button id="teach" type="button" class="ui-btn robot-btn" hidden>Teach it: let it copy you</button>
            </div>
          </li>
        </ol>
        <div class="tools">
          <button id="download" type="button" class="ui-btn ui-btn--ghost secondary">Download for robot simulators (URDF)</button>
          <button id="share" type="button" class="ui-btn ui-btn--ghost secondary">Copy a link to this object</button>
        </div>
        <p class="status" id="status" role="status">Loading…</p>
      </section>
      <section class="panel panel--gym gym" id="gym-panel">
        <h2>Robot Gym: things people made</h2>
        <ol id="gym"></ol>
      </section>
      <section class="panel panel--make make" id="make-panel">
        <h2>Make your own</h2>
        <form id="make">
          <label for="what">What is it?</label>
          <input id="what" maxlength="200" placeholder="a sewing box with a hinged lid" />
          <label for="photo">…or a photo of it</label>
          <input id="photo" type="file" accept="image/png,image/jpeg,image/webp" />
          <label for="moves">What should open?</label>
          <input id="moves" maxlength="240" placeholder="the lid swings up on its back hinge" required />
          <button type="submit" class="ui-btn">Make it</button>
          <p class="progress" id="progress" role="status"></p>
        </form>
      </section>
    </aside>
  </main>`;

document.querySelector('.cutouts__word')!.innerHTML = [...'ROBOTPROOF'].map((ch, i) => `<span style="--i:${i};--r:${(((i * 37) % 11) - 5) * 1.4}deg;--y:${(((i * 53) % 7) - 3) * 4}px">${ch}</span>`).join('');

const $ = <T extends HTMLElement>(s: string) => document.querySelector<T>(s)!;
const canvas = $<HTMLCanvasElement>('#view');
const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: true, preserveDrawingBuffer: true });
renderer.setClearColor(0x000000, 0);
renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
renderer.shadowMap.enabled = true;
renderer.outputColorSpace = THREE.SRGBColorSpace;
const camera = new THREE.PerspectiveCamera(40, 1, 0.01, 50);
const controls = new OrbitControls(camera, canvas);
controls.enableDamping = true;

const world = new World();
const robot = new Robot(world);
const caption = document.querySelector<HTMLParagraphElement>('#caption')!;
const cssColor = (name: string, fallback: string) => getComputedStyle(document.documentElement).getPropertyValue(name).trim() || fallback;
const armColors = () => ({ body: cssColor('--arm-body', '#f2f2f0'), dark: cssColor('--arm-dark', '#2b2b2b'), accent: cssColor('--arm-accent', '#ff6a00') });
let arm = new Arm(1, armColors());
arm.visible = false;
const statusEl = $<HTMLParagraphElement>('#status');
const pick = $<HTMLSelectElement>('#pick');
const pretty = (s: string) => s.replace(/_/g, ' ');

function resize() {
  const r = { width: canvas.clientWidth, height: canvas.clientHeight };
  renderer.setSize(r.width, r.height, false);
  camera.aspect = r.width / Math.max(1, r.height);
  // Put the object in the stage's free space, clear of the headline and paragraph: to the right of the
  // text when there's room, otherwise below it (zooming out a little if that space is short).
  const c = canvas.getBoundingClientRect();
  const i = document.querySelector('.intro')?.getBoundingClientRect();
  camera.zoom = 1;
  if (!i || r.width === 0 || r.height === 0) camera.clearViewOffset();
  else {
    // only the part of the stage that's on screen on first load counts
    const bottom = Math.min(c.bottom, c.top + Math.max(240, innerHeight - c.top));
    const rightFree = c.right - i.right, below = bottom - i.bottom;
    let cx = r.width / 2, cy = r.height / 2;
    if (rightFree > 0.42 * r.width) { cx = i.right - c.left + rightFree / 2; cy = r.height * 0.55; }
    else if (below > 0) { cy = i.bottom - c.top + below / 2; camera.zoom = Math.max(0.5, Math.min(1, below / (0.62 * r.height))); }
    camera.setViewOffset(r.width, r.height, r.width / 2 - cx, r.height / 2 - cy, r.width, r.height);
  }
  camera.updateProjectionMatrix();
}
addEventListener('resize', resize);

// The film: opens in a dialog and plays; closing it stops playback.
const film = document.querySelector<HTMLDialogElement>('#film')!;
const filmVideo = document.querySelector<HTMLVideoElement>('#film-video')!;
$('#film-open').addEventListener('click', (e) => { e.preventDefault(); film.showModal(); filmVideo.play().catch(() => {}); });
film.addEventListener('close', () => filmVideo.pause());
film.addEventListener('click', (e) => { if (e.target === film) film.close(); });

function renderGym() {
  const made = entries.filter((e) => e.id);
  const el = $('#gym');
  el.innerHTML = made.length
    ? made.slice(0, 12).map((e) => `<li><a href="?base=${encodeURIComponent(e.base)}" data-key="${esc(e.key)}">${esc(e.label)}</a> <small>${e.tries ? `stumped the robot ${e.stumped ?? 0} of ${e.tries} tries` : 'not tried yet'}</small></li>`).join('')
    : '<li><small>Nothing yet. Make the first one below.</small></li>';
  el.querySelectorAll<HTMLAnchorElement>('a[data-key]').forEach((a) => a.addEventListener('click', (ev) => {
    ev.preventDefault();
    const e = entries.find((x) => x.key === a.dataset.key);
    if (e) { show(e); renderPicker(); }
  }));
}

function renderPicker() {
  renderGym();
  const made = entries.filter((e) => e.id);
  pick.innerHTML =
    `<optgroup label="Examples">${BUILT_IN.map((e) => `<option value="${e.key}">${e.label}</option>`).join('')}</optgroup>` +
    (made.length ? `<optgroup label="Made by visitors">${made.map((e) => `<option value="${esc(e.key)}">${esc(e.label)}${e.stumped ? ` · stumped the robot ${e.stumped}×` : ''}</option>`).join('')}</optgroup>` : '');
  if (current) pick.value = current.key;
}

let humanOpened = false;
let grabStart = 0;
// Your drags, kept as demonstrations the robot can copy (and that ship in the download).
const demos = new Map<string, Demo>();
let rec: Demo | null = null;
let recSim = 0;
/** Text from visitors or from a URDF goes into HTML escaped. */
const esc = (s: unknown) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]!));
function jointOf(part: Part) { return world.object?.joints.find((j) => j.child === part); }
function demoMax(d: Demo) { return d.joint.length ? Math.max(...d.joint) : 0; }
async function show(entry: Entry) {
  statusEl.textContent = 'Loading…';
  current = entry;
  const obj = await world.load(entry.base);
  const s = obj.size;
  const r = Math.max(s.x, s.y, s.z);
  controls.target.set(0, s.y * 0.45, 0);
  camera.position.set(r * 1.6, s.y * 0.45 + r * 1.1, r * 2.2);
  controls.update();
  $('#joints').innerHTML = obj.joints
    .map((j, i) => `<li><span class="joint__name">${esc(pretty(j.def.child))} <small>${j.def.type === 'prismatic' ? 'slides' : 'hinged'}</small></span><b class="joint__pct" id="p${i}">0%</b><meter id="m${i}" min="0" max="1" value="0"></meter></li>`)
    .join('');
  statusEl.textContent = `${obj.joints.length} moving part${obj.joints.length === 1 ? '' : 's'} · about ${Math.round(s.x * 100)} × ${Math.round(s.y * 100)} × ${Math.round(s.z * 100)} cm`;
  world.scene.remove(arm);
  arm = new Arm(Math.max(0.6, Math.max(s.x, s.y, s.z) * 1.3), armColors());
  arm.position.set(s.x * 0.15, 0, Math.max(s.z, 0.3) * 0.5 + Math.max(s.x, s.y, s.z) * 0.9);
  arm.visible = false;
  world.scene.add(arm);
  humanOpened = false;
  if (holding) { holding = false; paused = false; }
  demos.clear();
  $('#teach').hidden = true;
  $('#you').textContent = 'Your turn first: open it with the mouse.';
  $('#verdict').textContent = '';
  $('#attempts').innerHTML = '';
  $('#stamp').hidden = true;
  $('#hint').classList.remove('gone');
  if (entry.key !== 'shared') history.replaceState(null, '', `?object=${encodeURIComponent(entry.key)}`);
  resize();
  (window as any).__robotproof = { world, camera, canvas, robot, demos, pause: (v: boolean) => { paused = v; }, ready: true, id: entry.key };
}

// Drag: a spring pulls the grabbed point toward the cursor on a camera-facing plane.
const ray = new THREE.Raycaster();
const ndc = new THREE.Vector2();
let grab: { part: Part; local: THREE.Vector3; plane: THREE.Plane; target: THREE.Vector3 } | null = null;
function setNdc(e: PointerEvent) {
  const r = canvas.getBoundingClientRect();
  ndc.set(((e.clientX - r.left) / r.width) * 2 - 1, -((e.clientY - r.top) / r.height) * 2 + 1);
}
canvas.addEventListener('pointerdown', (e) => {
  if (!world.object || robotBusy) return;
  if (holding) { holding = false; paused = false; arm.visible = false; }
  setNdc(e);
  ray.setFromCamera(ndc, camera);
  const hits = ray.intersectObjects(world.object.parts.map((p) => p.mesh), true);
  const hit = hits.find((h) => !world.partOf(h.object)?.isRoot);
  if (!hit) return;
  const part = world.partOf(hit.object)!;
  const local = part.mesh.worldToLocal(hit.point.clone());
  const normal = camera.getWorldDirection(new THREE.Vector3()).negate();
  grab = { part, local, plane: new THREE.Plane().setFromNormalAndCoplanarPoint(normal, hit.point), target: hit.point.clone() };
  if (!grabStart) grabStart = performance.now();
  rec = { part: part.name, local: local.clone(), path: [], t: [], joint: [] };
  recSim = 0;
  controls.enabled = false;
  canvas.setPointerCapture(e.pointerId);
  $('#hint').classList.add('gone');
});
canvas.addEventListener('pointermove', (e) => {
  if (!grab) return;
  setNdc(e);
  ray.setFromCamera(ndc, camera);
  ray.ray.intersectPlane(grab.plane, grab.target);
});
const release = () => {
  if (rec && rec.path.length >= 2) {
    const prev = demos.get(rec.part);
    // keep the drag that opened the part furthest
    if (!prev || demoMax(rec) >= demoMax(prev)) demos.set(rec.part, rec);
  }
  rec = null;
  grab = null;
  controls.enabled = true;
};
canvas.addEventListener('pointerup', release);
canvas.addEventListener('pointercancel', release);

function applyGrab() {
  if (!grab) return;
  const b = grab.part.body;
  const p = grab.part.mesh.localToWorld(grab.local.clone());
  const v = b.linvel();
  const k = 400 * grab.part.mass, c = 40 * grab.part.mass;
  const f = grab.target.clone().sub(p).multiplyScalar(k).sub(new THREE.Vector3(v.x, v.y, v.z).multiplyScalar(c));
  b.addForceAtPoint({ x: f.x, y: f.y, z: f.z }, { x: p.x, y: p.y, z: p.z }, true);
}

// Live readout of how far each part is open: a real number from the physics.
function showOpenness(i: number, o: number) {
  const m = document.querySelector<HTMLMeterElement>(`#m${i}`);
  if (m) m.value = o;
  const p = document.querySelector<HTMLElement>(`#p${i}`);
  if (p) p.textContent = `${Math.round(Math.max(0, Math.min(1, o)) * 100)}%`;
}
let robotBusy = false;
let holding = false;
let robotFrame = 0;
// The signature moment: a STUMPED stamp lands on the stage when the robot gives up.
function slapStamp(on: boolean, word = 'STUMPED') {
  const el = $('#stamp');
  el.hidden = !on;
  if (!on) return;
  el.classList.toggle('stamp--learned', word !== 'STUMPED');
  el.innerHTML = [...word].map((ch, i) => `<span style="--i:${i};--r:${(((i * 37) % 11) - 5) * 1.8}deg">${ch}</span>`).join('');
  el.classList.remove('stamp--in');
  void el.offsetWidth;
  el.classList.add('stamp--in');
}
$('#robot').addEventListener('click', async () => {
  if (!world.object || robotBusy) return;
  robotBusy = true;
  holding = false;
  const btn = $<HTMLButtonElement>('#robot');
  btn.disabled = true;
  const verdict = $('#verdict');
  verdict.textContent = 'The robot is trying…';
  $('#hint').classList.add('gone');
  $('#attempts').innerHTML = '';
  $('#stamp').hidden = true;
  $('#teach').hidden = true;
  arm.visible = true;
  paused = true;
  const res = await robot.run({
    frameDelay: 8,
    onStep: (h, _p, part, strategy) => {
      arm.reach(h);
      if (++robotFrame % 3 === 0) renderer.render(world.scene, camera);
      verdict.textContent = `Trying the ${pretty(part.name)}: ${strategy}`;
      caption.hidden = false;
      caption.textContent = verdict.textContent;
      if (robotFrame % 3 === 0) world.object?.joints.forEach((j, i) => showOpenness(i, world.openness(j)));
    },
  });
  paused = false;
  arm.visible = false;
  caption.hidden = true;
  $('#attempts').innerHTML = res.attempts.map((a) => `<li>${esc(pretty(a.part))}: ${a.strategy}, opened ${Math.round(a.opened * 100)}% ${a.success ? '✓' : '✗'}</li>`).join('');
  const stumped = res.stumped.length > 0;
  verdict.textContent = stumped
    ? `STUMPED. The robot couldn't open the ${res.stumped.map(pretty).join(', ')}.${humanOpened ? ' You could.' : ''}`
    : `The robot opened everything (${res.opened.length} part${res.opened.length === 1 ? '' : 's'}).`;
  verdict.classList.toggle('stumped', stumped);
  slapStamp(stumped);
  const teachable = res.stumped.filter((n) => demos.has(n));
  $('#teach').hidden = teachable.length === 0;
  if (stumped && !teachable.length) verdict.textContent += ' Open it yourself, then you can teach it.';
  (window as any).__robotproof.lastRun = res;
  if (current?.id) {
    fetch('/api/gallery', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ id: current.id, human: humanOpened, robot: res }) }).catch(() => {});
  }
  btn.disabled = false;
  robotBusy = false;
});

// Teach: the robot copies your drag (where you grabbed and where your hand went). It still never reads the joint.
$('#teach').addEventListener('click', async () => {
  if (!world.object || robotBusy || !demos.size) return;
  robotBusy = true;
  const btn = $<HTMLButtonElement>('#teach');
  btn.disabled = true;
  const verdict = $('#verdict');
  verdict.classList.remove('stumped');
  $('#stamp').hidden = true;
  arm.visible = true;
  paused = true;
  const res = await robot.imitate(demos, {
    frameDelay: 8,
    onStep: (h, _p, part, strategy) => {
      arm.reach(h);
      if (++robotFrame % 3 === 0) renderer.render(world.scene, camera);
      verdict.textContent = `Copying how you opened the ${pretty(part.name)}…`;
      caption.hidden = false;
      caption.textContent = strategy === 'copying you' ? `Robot: copying your grab on the ${pretty(part.name)}` : `Robot: ${strategy}`;
      if (robotFrame % 3 === 0) world.object?.joints.forEach((j, i) => showOpenness(i, world.openness(j)));
    },
  });
  caption.hidden = true;
  $('#attempts').innerHTML += res.attempts.map((a) => `<li>${esc(pretty(a.part))}: copied you, opened ${Math.round(a.opened * 100)}% ${a.success ? '✓' : '✗'}</li>`).join('');
  const learned = res.opened.length > 0 && res.stumped.length === 0;
  verdict.textContent = learned
    ? `LEARNED. After one look at how you did it, the robot opened the ${res.opened.map(pretty).join(', ')} (more than half open counts).`
    : `Still stumped. Even copying you, it couldn't open the ${res.stumped.map(pretty).join(', ')}.`;
  verdict.classList.toggle('stumped', !learned);
  slapStamp(true, learned ? 'LEARNED' : 'STUMPED');
  // On success the arm keeps holding the part open (physics paused) until you touch the object again.
  holding = learned;
  if (!learned) { paused = false; arm.visible = false; }
  (window as any).__robotproof.lastTeach = res;
  btn.disabled = false;
  btn.hidden = true;
  robotBusy = false;
});

$('#download').addEventListener('click', async () => {
  if (!world.object || !current) return;
  const btn = $<HTMLButtonElement>('#download');
  btn.disabled = true;
  btn.textContent = 'Packing…';
  try {
    const name = 'robotproof-' + current.key.replace(/[^a-z0-9-]/gi, '-');
    const blob = await buildZip(current.base, world.object, name, [...demos.values()]);
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = name + '.zip';
    a.click();
  } catch (e: any) {
    statusEl.textContent = `Couldn't build the download: ${e.message}`;
  } finally {
    btn.disabled = false;
    btn.textContent = 'Download for robot simulators (URDF)';
  }
});

$('#share').addEventListener('click', async () => {
  if (!current) return;
  const url = current.id
    ? `${location.origin}/?base=${encodeURIComponent(current.base)}`
    : `${location.origin}/?object=${encodeURIComponent(current.key)}`;
  try { await navigator.clipboard.writeText(url); statusEl.textContent = 'Link copied.'; }
  catch { statusEl.textContent = url; }
});

// --- Make your own: Lux3D builds it, then finds the moving parts -----------------------------------
const progress = $('#progress');
const STAGES: Record<string, string> = {
  mesh: 'Lux3D is building the 3D model (about 2 minutes)…',
  joints: 'Lux3D is finding the hinges and drawers (about 4 minutes)…',
  waiting: 'Model ready. Waiting for a free Lux3D slot to find the hinges…',
};
async function toDataUrl(f: File): Promise<string> {
  // Downscale big photos before upload.
  const img = await createImageBitmap(f);
  const scale = Math.min(1, 1600 / Math.max(img.width, img.height));
  const c = document.createElement('canvas');
  c.width = Math.round(img.width * scale); c.height = Math.round(img.height * scale);
  c.getContext('2d')!.drawImage(img, 0, 0, c.width, c.height);
  return c.toDataURL('image/jpeg', 0.88);
}

interface Pending { meshTask: string; moves: string; label: string; started: number }
async function follow(p: Pending) {
  localStorage.setItem('robotproof:pending', JSON.stringify(p));
  const btn = $<HTMLButtonElement>('#make button[type=submit]');
  btn.disabled = true;
  for (;;) {
    const r = await fetch(`/api/job?mesh=${p.meshTask}&moves=${encodeURIComponent(p.moves)}&label=${encodeURIComponent(p.label)}`);
    const j = await r.json().catch(() => ({ stage: 'error', error: `Server error ${r.status}` }));
    const mins = Math.floor((Date.now() - p.started) / 60000), secs = Math.floor(((Date.now() - p.started) / 1000) % 60);
    if (j.stage === 'done') {
      localStorage.removeItem('robotproof:pending');
      progress.textContent = `Ready in ${mins}:${String(secs).padStart(2, '0')}. Open it yourself, then let the robot try.`;
      const entry: Entry = { key: j.id, id: j.id, label: p.label, base: j.base };
      entries = [entry, ...entries.filter((e) => e.key !== j.id)];
      renderPicker();
      await show(entry);
      renderPicker();
      break;
    }
    if (j.stage === 'failed' || j.stage === 'error') {
      localStorage.removeItem('robotproof:pending');
      progress.textContent = `That didn't work: ${j.error}`;
      break;
    }
    progress.textContent = `${STAGES[j.stage] ?? 'Working…'} ${mins}:${String(secs).padStart(2, '0')}`;
    await new Promise((res) => setTimeout(res, 8000));
  }
  btn.disabled = false;
}

$('#make').addEventListener('submit', async (e) => {
  e.preventDefault();
  const what = $<HTMLInputElement>('#what').value.trim();
  const file = $<HTMLInputElement>('#photo').files?.[0];
  const moves = $<HTMLInputElement>('#moves').value.trim();
  if (!what && !file) { progress.textContent = 'Describe the object or add a photo.'; return; }
  progress.textContent = 'Sending to Lux3D…';
  try {
    const body: any = { prompt: what, moves };
    if (file) body.image = await toDataUrl(file);
    let r: Response, j: any;
    const t0 = Date.now();
    for (;;) {
      r = await fetch('/api/make', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
      j = await r.json().catch(() => ({ error: `Server error ${r.status}` }));
      if (r.status !== 503 || !j.busy) break;
      // Lux3D runs a few objects at a time; wait for a slot (keep the uploaded photo, don't send it again).
      if (j.photoUrl) { delete body.image; body.photoUrl = j.photoUrl; }
      const s = Math.round((Date.now() - t0) / 1000);
      progress.textContent = `Lux3D is busy with other objects. Waiting for a free slot… ${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
      await new Promise((res) => setTimeout(res, 20000));
    }
    if (!r.ok) { progress.textContent = j.error ?? `Server error ${r.status}`; return; }
    await follow({ meshTask: j.meshTask, moves: j.moves, label: what || 'Your photo', started: Date.now() });
  } catch (err: any) {
    progress.textContent = `That didn't work: ${err.message}`;
  }
});

// --- Loop -----------------------------------------------------------------------------------------
let paused = false;
let last = performance.now();
let lastFrame = performance.now();
// If animation frames stall (hidden or embedded pane), keep the physics running on a timer.
setInterval(() => { if (performance.now() - lastFrame > 120) tick(performance.now()); }, 16);
function frame(now: number) {
  lastFrame = performance.now();
  tick(now);
  requestAnimationFrame(frame);
}
function tick(now: number) {
  const dt = Math.min(0.25, (now - last) / 1000);
  last = now;
  if (world.object && !paused) {
    world.step(dt, {
      before: () => { world.object!.parts.forEach((p) => p.body.resetForces(true)); applyGrab(); },
      after: () => {
        // record the drag at physics rate: one sample per 1/30 s of simulated time
        if (!grab || !rec || grab.part.name !== rec.part) return;
        recSim += world.physics.timestep;
        if (rec.t.length && recSim - rec.t[rec.t.length - 1] < 1 / 30 - 1e-6) return;
        const j = jointOf(grab.part);
        rec.path.push(grab.part.mesh.localToWorld(rec.local.clone()));
        rec.t.push(+recSim.toFixed(3));
        rec.joint.push(j ? +world.openness(j).toFixed(3) : 0);
      },
    });
    world.object.joints.forEach((j, i) => {
      const o = world.openness(j);
      showOpenness(i, o);
      if (!humanOpened && grab && o >= 0.5) {
        humanOpened = true;
        const t = ((performance.now() - grabStart) / 1000).toFixed(1);
        $('#you').textContent = `You opened the ${pretty(j.def.child)} in ${t} s. Now let the robot try, without telling it how.`;
      }
    });
  }
  controls.update();
  renderer.render(world.scene, camera);
}

(async () => {
  resize();
  await world.init();
  world.scene.background = null;
  renderPicker();
  const want = new URLSearchParams(location.search).get('object');
  try {
    const g = await (await fetch('/api/gallery')).json();
    for (const it of g.items ?? []) entries.push({ key: it.id, id: it.id, label: it.label, base: it.base, stumped: it.stumped, tries: it.tries });
  } catch { /* the gallery is optional; the examples still work */ }
  renderPicker();
  // ?base=<folder with robot.urdf> opens any object folder from this site or its Blob store (share links, evidence runs).
  const baseParam = new URLSearchParams(location.search).get('base');
  if (baseParam && (/^\/[\w\-\/]+\/$/.test(baseParam) || /^https:\/\/qhuaqity4gffgh3y\.public\.blob\.vercel-storage\.com\/objects\/\d+\/$/.test(baseParam))) {
    entries.push({ key: 'shared', label: 'Shared object', base: baseParam });
  }
  const first = (baseParam && entries.find((e) => e.key === 'shared')) || entries.find((e) => e.key === want) || BUILT_IN[0];
  pick.addEventListener('change', () => { const e = entries.find((x) => x.key === pick.value); if (e) show(e); });
  await show(first);
  renderPicker();
  requestAnimationFrame(frame);
  const pending = localStorage.getItem('robotproof:pending');
  if (pending) follow(JSON.parse(pending));
})().catch((err) => {
  statusEl.textContent = `Couldn't load the object: ${err.message}`;
  console.error(err);
});
