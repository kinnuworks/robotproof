import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { World, type Part } from './world';
import { Robot } from './robot';
import './style.css';

const GALLERY: { id: string; label: string }[] = [
  { id: 'chest', label: 'Wooden chest' },
  { id: 'nightstand', label: 'Two-drawer nightstand' },
];

const app = document.querySelector<HTMLDivElement>('#app')!;
app.innerHTML = `
  <header>
    <h1>Robotproof</h1>
    <p class="tagline">Make something robots can't open.</p>
  </header>
  <main>
    <section class="stage">
      <canvas id="view"></canvas>
      <div class="hint" id="hint">Drag a lid or drawer to open it</div>
    </section>
    <aside>
      <label for="pick">Object</label>
      <select id="pick">${GALLERY.map((g) => `<option value="${g.id}">${g.label}</option>`).join('')}</select>
      <h2>Joints</h2>
      <ul id="joints"></ul>
      <button id="robot" type="button">Let the robot try</button>
      <p class="verdict" id="verdict" role="status"></p>
      <ol id="attempts"></ol>
      <p class="status" id="status" role="status">Loading…</p>
    </aside>
  </main>`;

const canvas = document.querySelector<HTMLCanvasElement>('#view')!;
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
const statusEl = document.querySelector<HTMLParagraphElement>('#status')!;
const jointsEl = document.querySelector<HTMLUListElement>('#joints')!;
const pick = document.querySelector<HTMLSelectElement>('#pick')!;

function resize() {
  const r = canvas.parentElement!.getBoundingClientRect();
  renderer.setSize(r.width, r.height, false);
  camera.aspect = r.width / Math.max(1, r.height);
  camera.updateProjectionMatrix();
}
addEventListener('resize', resize);

async function show(id: string) {
  statusEl.textContent = 'Loading…';
  const obj = await world.load(`/objects/${id}/`);
  const s = obj.size;
  const r = Math.max(s.x, s.y, s.z);
  controls.target.set(0, s.y * 0.45, 0);
  camera.position.set(r * 1.6, s.y * 0.45 + r * 1.1, r * 2.2);
  controls.update();
  jointsEl.innerHTML = obj.joints
    .map((j, i) => `<li><span>${j.def.child.replace(/_/g, ' ')}</span> <small>${j.def.type === 'prismatic' ? 'slides' : 'hinged'}</small><meter id="m${i}" min="0" max="1" value="0"></meter></li>`)
    .join('');
  statusEl.textContent = `${obj.joints.length} moving part${obj.joints.length === 1 ? '' : 's'}`;
  world.scene.add(hand);
  (window as any).__robotproof = { world, camera, canvas, robot, ready: true, id };
  document.querySelector('#verdict')!.textContent = '';
  document.querySelector('#attempts')!.innerHTML = '';
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
  if (!world.object) return;
  setNdc(e);
  ray.setFromCamera(ndc, camera);
  const hits = ray.intersectObjects(world.object.parts.map((p) => p.mesh), true);
  const hit = hits.find((h) => !world.partOf(h.object)?.isRoot);
  if (!hit) return;
  const part = world.partOf(hit.object)!;
  const local = part.mesh.worldToLocal(hit.point.clone());
  const normal = camera.getWorldDirection(new THREE.Vector3()).negate();
  grab = { part, local, plane: new THREE.Plane().setFromNormalAndCoplanarPoint(normal, hit.point), target: hit.point.clone() };
  controls.enabled = false;
  canvas.setPointerCapture(e.pointerId);
  document.querySelector('#hint')!.classList.add('gone');
});
canvas.addEventListener('pointermove', (e) => {
  if (!grab) return;
  setNdc(e);
  ray.setFromCamera(ndc, camera);
  ray.ray.intersectPlane(grab.plane, grab.target);
});
let robotBusy = false;
document.querySelector('#robot')!.addEventListener('click', async () => {
  if (!world.object || robotBusy) return;
  robotBusy = true;
  const btn = document.querySelector<HTMLButtonElement>('#robot')!;
  btn.disabled = true;
  const verdict = document.querySelector('#verdict')!;
  const list = document.querySelector('#attempts')!;
  verdict.textContent = 'The robot is trying…';
  list.innerHTML = '';
  hand.visible = true;
  paused = true;
  const res = await robot.run({
    frameDelay: 8,
    onStep: (h, _p, part, strategy) => {
      hand.position.copy(h);
      renderer.render(world.scene, camera);
      verdict.textContent = `Trying the ${part.name.replace(/_/g, ' ')}: ${strategy}`;
    },
  });
  paused = false;
  hand.visible = false;
  list.innerHTML = res.attempts.map((a) => `<li>${a.part.replace(/_/g, ' ')}: ${a.strategy}, opened ${Math.round(a.opened * 100)}% ${a.success ? '✓' : '✗'}</li>`).join('');
  verdict.textContent = res.stumped.length
    ? `STUMPED. The robot couldn't open: ${res.stumped.map((s) => s.replace(/_/g, ' ')).join(', ')}.`
    : `The robot opened everything (${res.opened.length} part${res.opened.length === 1 ? '' : 's'}).`;
  (window as any).__robotproof.lastRun = res;
  btn.disabled = false;
  robotBusy = false;
});

const release = () => { grab = null; controls.enabled = true; };
canvas.addEventListener('pointerup', release);
canvas.addEventListener('pointercancel', release);

function applyGrab() {
  if (!grab) return;
  const b = grab.part.body;
  const p = grab.part.mesh.localToWorld(grab.local.clone());
  const v = b.linvel();
  const k = 60 * grab.part.mass, c = 6 * grab.part.mass;
  const f = grab.target.clone().sub(p).multiplyScalar(k).sub(new THREE.Vector3(v.x, v.y, v.z).multiplyScalar(c));
  b.addForceAtPoint({ x: f.x, y: f.y, z: f.z }, { x: p.x, y: p.y, z: p.z }, true);
}

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
      const m = document.querySelector<HTMLMeterElement>(`#m${i}`);
      if (m) m.value = world.openness(j);
    });
  }
  controls.update();
  renderer.render(world.scene, camera);
}

(async () => {
  resize();
  await world.init();
  world.scene.background = new THREE.Color(0xf4f2ee);
  const want = new URLSearchParams(location.search).get('object');
  const first = GALLERY.find((g) => g.id === want)?.id ?? GALLERY[0].id;
  pick.value = first;
  pick.addEventListener('change', () => show(pick.value));
  await show(first);
  requestAnimationFrame(frame);
})().catch((err) => {
  statusEl.textContent = `Couldn't load the object: ${err.message}`;
  console.error(err);
});
