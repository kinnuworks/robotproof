// A simple two-link robot arm drawn to follow the gripper. Visual only: the grip itself is a held
// point with a capped force (see robot.ts). Base on the floor, yaw at the base, shoulder and elbow pitch.
import * as THREE from 'three';

export class Arm extends THREE.Group {
  private yaw = new THREE.Group();
  private shoulder = new THREE.Group();
  private elbow = new THREE.Group();
  private wrist = new THREE.Group();
  private L1: number;
  private L2: number;
  private H: number;

  constructor(scale = 1) {
    super();
    this.L1 = 0.55 * scale; this.L2 = 0.5 * scale; this.H = 0.25 * scale;
    const body = new THREE.MeshStandardMaterial({ color: 0xf2f2f0, metalness: 0.1, roughness: 0.45 });
    const dark = new THREE.MeshStandardMaterial({ color: 0x2b2b2b, metalness: 0.4, roughness: 0.5 });
    const accent = new THREE.MeshStandardMaterial({ color: 0xff6a00, metalness: 0.1, roughness: 0.5 });
    const r = 0.045 * scale;
    const base = new THREE.Mesh(new THREE.CylinderGeometry(r * 2, r * 2.4, this.H, 24), dark);
    base.position.y = this.H / 2;
    this.add(base);
    this.yaw.position.y = this.H;
    this.add(this.yaw);
    const joint = (m: THREE.Material) => new THREE.Mesh(new THREE.SphereGeometry(r * 1.25, 20, 16), m);
    this.yaw.add(this.shoulder, joint(accent));
    const link = (len: number) => {
      const g = new THREE.CapsuleGeometry(r, len - 2 * r, 6, 16);
      g.translate(0, len / 2, 0);
      return new THREE.Mesh(g, body);
    };
    this.shoulder.add(link(this.L1));
    this.elbow.position.y = this.L1;
    this.shoulder.add(this.elbow);
    this.elbow.add(joint(accent), link(this.L2));
    this.wrist.position.y = this.L2;
    this.elbow.add(this.wrist);
    const palm = new THREE.Mesh(new THREE.BoxGeometry(r * 2.2, r * 0.8, r * 1.4), dark);
    const f1 = new THREE.Mesh(new THREE.BoxGeometry(r * 0.35, r * 1.4, r * 0.9), dark);
    f1.position.set(-r * 0.8, r * 1.0, 0);
    const f2 = f1.clone(); f2.position.x = r * 0.8;
    this.wrist.add(palm, f1, f2);
    this.traverse((o) => { if ((o as THREE.Mesh).isMesh) (o as THREE.Mesh).castShadow = true; });
  }

  /** Point the gripper at a world position (reaches as far as it can). */
  reach(target: THREE.Vector3) {
    const local = this.worldToLocal(target.clone());
    const dx = local.x, dz = local.z, dy = local.y - this.H;
    this.yaw.rotation.y = Math.atan2(dx, dz);
    const d = Math.min(Math.hypot(dx, dz, dy), this.L1 + this.L2 - 1e-3);
    const horiz = Math.hypot(dx, dz);
    const elev = Math.atan2(dy, horiz);
    const cosE = (this.L1 ** 2 + this.L2 ** 2 - d * d) / (2 * this.L1 * this.L2);
    const elbowBend = Math.PI - Math.acos(Math.max(-1, Math.min(1, cosE)));
    const cosS = (this.L1 ** 2 + d * d - this.L2 ** 2) / (2 * this.L1 * d);
    const shoulderUp = elev + Math.acos(Math.max(-1, Math.min(1, cosS)));
    // links point along +Y; tilt them forward (toward +Z of the yaw frame)
    this.shoulder.rotation.x = Math.PI / 2 - shoulderUp;
    this.elbow.rotation.x = elbowBend;
    this.wrist.rotation.x = -(Math.PI / 2 - shoulderUp) - elbowBend + Math.PI / 2;
  }
}
