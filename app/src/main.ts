import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { World, type Part } from './world';
import { Robot } from './robot';
import { buildZip } from './export';
import './style.css';

interface Entry { key: string; label: string; base: string; id?: string; stumped?: number; tries?: number }

const BUILT_IN: Entry[] = [
  { key: 'chest', label: 'Wooden chest', base: '/objects/chest/' },
  { key: 'nightstand', label: 'Two-drawer nightstand', base: '/objects/nightstand/' },
];
let entries: Entry[] = [...BUILT_IN];
let current: Entry | null = null;

const app = document.querySelector<HTMLDivElement>('#app')!;
app.innerHTML = `
  <header>
    <h1>Robotproof</h1>
    <p class="tagline">Make something robots can't open.</p>
  </header>
  <main>
    <section class="stage">
      <canvas id="view" aria-label="3D view of the object. Drag a lid or drawer to open it."></canvas>
      <div class="hint" id="hint">Drag a lid or drawer to open it</div>
      <div class="banner" id="banner" hidden></div>
    </section>
    <aside>
      <section>
        <label for="pick">Object</label>
        <select id="pick"></select>
        <h2>Moving parts</h2>
        <ul id="joints"></ul>
        <p class="you" id="you"></p>
        <button id="robot" type="button">Let the robot try</button>
        <p class="verdict" id="verdict" role="status"></p>
        <ol id="attempts"></ol>
        <button id="download" type="button" class="secondary">Download for robot simulators (URDF)</button>
        <p class="status" id="status" role="status">Loading…</p>
      </section>
      <section class="make">
        <h2>Make your own</h2>
        <form id="make">
          <label for="what">What is it?</label>
          <input id="what" maxlength="200" placeholder="a sewing box with a hinged lid" />
          <label for="photo">…or a photo of it</label>
          <input id="photo" type="file" accept="image/png,image/jpeg,image/webp" />
          <label for="moves">What should open?</label>
          <input id="moves" maxlength="240" placeholder="the lid swings up on its back hinge" required />
          <button type="submit">Make it</button>
          <p class="progress" id="progress" role="status"></p>
        </form>
      </section>
    </aside>
  </main>`;

const $ = <T extends HTMLElement>(s: string) => document.querySelector<T>(s)!;
const canvas = $<HTMLCanvasElement>('#view');
const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, preserveDrawingBuffer: true });
renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
renderer.shadowMap.enabled = true;
renderer.outputColorSpace = THREE.SRGBColorSpace;
const camera = new THREE.PerspectiveCamera(40, 1, 0.01, 50);
const controls = new OrbitControls(camera, canvas);
controls.enableDamping = true;

const world = new World();
const robot = new Robot(world);
const hand = new THREE.Group();
{
  const mat = new THREE.MeshStandardMaterial({ color: 0x333333, metalness: 0.3, roughness: 0.5 });
  const palm = new THREE.Mesh(new THREE.BoxGeometry(0.06, 0.02, 0.03), mat);
  const f1 = new THREE.Mesh(new THREE.BoxGeometry(0.01, 0.05, 0.02), mat); f1.position.set(-0.025, -0.03, 0);
  const f2 = f1.clone(); f2.position.x = 0.025;
  const arm = new THREE.Mesh(new THREE.CylinderGeometry(0.008, 0.008, 1, 8), mat); arm.position.y = 0.51;
  hand.add(palm, f1, f2, arm);
  hand.visible = false;
}
const statusEl = $<HTMLParagraphElement>('#status');
const pick = $<HTMLSelectElement>('#pick');
const pretty = (s: string) => s.replace(/_/g, ' ');

function resize() {
  const r = canvas.parentElement!.getBoundingClientRect();
  renderer.setSize(r.width, r.height, false);
  camera.aspect = r.width / Math.max(1, r.height);
  camera.updateProjectionMatrix();
}
addEventListener('resize', resize);

function renderPicker() {
  const made = entries.filter((e) => e.id);
  pick.innerHTML =
    `<optgroup label="Examples">${BUILT_IN.map((e) => `<option value="${e.key}">${e.label}</option>`).join('')}</optgroup>` +
    (made.length ? `<optgroup label="Made by visitors">${made.map((e) => `<option value="${e.key}">${e.label}${e.stumped ? ` · stumped the robot ${e.stumped}×` : ''}</option>`).join('')}</optgroup>` : '');
  if (current) pick.value = current.key;
}

let humanOpened = false;
let grabStart = 0;
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
    .map((j, i) => `<li><span>${pretty(j.def.child)}</span> <small>${j.def.type === 'prismatic' ? 'slides' : 'hinged'}</small><meter id="m${i}" min="0" max="1" value="0"></meter></li>`)
    .join('');
  statusEl.textContent = `${obj.joints.length} moving part${obj.joints.length === 1 ? '' : 's'} · about ${Math.round(s.x * 100)} × ${Math.round(s.y * 100)} × ${Math.round(s.z * 100)} cm`;
  world.scene.add(hand);
  humanOpened = false;
  $('#you').textContent = 'Your turn first: open it with the mouse.';
  $('#verdict').textContent = '';
  $('#attempts').innerHTML = '';
  $('#hint').classList.remove('gone');
  history.replaceState(null, '', `?object=${encodeURIComponent(entry.key)}`);
  (window as any).__robotproof = { world, camera, canvas, robot, ready: true, id: entry.key };
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
const release = () => { grab = null; controls.enabled = true; };
canvas.addEventListener('pointerup', release);
canvas.addEventListener('pointercancel', release);

function applyGrab() {
  if (!grab) return;
  const b = grab.part.body;
  const p = grab.part.mesh.localToWorld(grab.local.clone());
  const v = b.linvel();
  const k = 160 * grab.part.mass, c = 14 * grab.part.mass;
  const f = grab.target.clone().sub(p).multiplyScalar(k).sub(new THREE.Vector3(v.x, v.y, v.z).multiplyScalar(c));
  b.addForceAtPoint({ x: f.x, y: f.y, z: f.z }, { x: p.x, y: p.y, z: p.z }, true);
}

let robotBusy = false;
let robotFrame = 0;
$('#robot').addEventListener('click', async () => {
  if (!world.object || robotBusy) return;
  robotBusy = true;
  const btn = $<HTMLButtonElement>('#robot');
  btn.disabled = true;
  const verdict = $('#verdict');
  verdict.textContent = 'The robot is trying…';
  $('#attempts').innerHTML = '';
  hand.visible = true;
  paused = true;
  const res = await robot.run({
    frameDelay: 8,
    onStep: (h, _p, part, strategy) => {
      hand.position.copy(h);
      if (++robotFrame % 3 === 0) renderer.render(world.scene, camera);
      verdict.textContent = `Trying the ${pretty(part.name)}: ${strategy}`;
    },
  });
  paused = false;
  hand.visible = false;
  $('#attempts').innerHTML = res.attempts.map((a) => `<li>${pretty(a.part)}: ${a.strategy}, opened ${Math.round(a.opened * 100)}% ${a.success ? '✓' : '✗'}</li>`).join('');
  const stumped = res.stumped.length > 0;
  verdict.textContent = stumped
    ? `STUMPED. The robot couldn't open the ${res.stumped.map(pretty).join(', ')}.${humanOpened ? ' You could.' : ''}`
    : `The robot opened everything (${res.opened.length} part${res.opened.length === 1 ? '' : 's'}).`;
  verdict.classList.toggle('stumped', stumped);
  (window as any).__robotproof.lastRun = res;
  if (current?.id) {
    fetch('/api/gallery', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ id: current.id, human: humanOpened, robot: res }) }).catch(() => {});
  }
  btn.disabled = false;
  robotBusy = false;
});

$('#download').addEventListener('click', async () => {
  if (!world.object || !current) return;
  const btn = $<HTMLButtonElement>('#download');
  btn.disabled = true;
  btn.textContent = 'Packing…';
  try {
    const name = 'robotproof-' + current.key.replace(/[^a-z0-9-]/gi, '-');
    const blob = await buildZip(current.base, world.object, name);
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

// --- Make your own: Lux3D builds it, then finds the moving parts -----------------------------------
const progress = $('#progress');
const STAGES: Record<string, string> = {
  mesh: 'Lux3D is building the 3D model (about 2 minutes)…',
  joints: 'Lux3D is finding the hinges and drawers (about 4 minutes)…',
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
    const r = await fetch('/api/make', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
    const j = await r.json();
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
  const dt = Math.min(0.05, (now - last) / 1000);
  last = now;
  if (world.object && !paused) {
    world.object.parts.forEach((p) => p.body.resetForces(true));
    applyGrab();
    world.step(dt);
    world.object.joints.forEach((j, i) => {
      const o = world.openness(j);
      const m = document.querySelector<HTMLMeterElement>(`#m${i}`);
      if (m) m.value = o;
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
  world.scene.background = new THREE.Color(0xf4f2ee);
  renderPicker();
  const want = new URLSearchParams(location.search).get('object');
  try {
    const g = await (await fetch('/api/gallery')).json();
    for (const it of g.items ?? []) entries.push({ key: it.id, id: it.id, label: it.label, base: it.base, stumped: it.stumped, tries: it.tries });
  } catch { /* the gallery is optional; the examples still work */ }
  renderPicker();
  const first = entries.find((e) => e.key === want) ?? BUILT_IN[0];
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
