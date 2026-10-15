import * as THREE from "three";

const tmp = new THREE.Vector3();

export class CameraRig {
  constructor(game) {
    this.game = game;
    this.cam = game.engine.camera;
    this.yaw = 0;
    this.pitch = 0.28;
    this.dist = 4.6;
    this.mode = "third";
    this.aim = 0;
    this.shake = 0;
    this.cinematic = null;
    this.pos = new THREE.Vector3();
    this.look = new THREE.Vector3();
    this.baseFov = 62;
  }

  forward(out = new THREE.Vector3()) {
    return out.set(Math.sin(this.yaw), 0, Math.cos(this.yaw));
  }

  aimDir(out = new THREE.Vector3()) {
    return out.set(Math.sin(this.yaw) * Math.cos(this.pitch), -Math.sin(this.pitch), Math.cos(this.yaw) * Math.cos(this.pitch)).normalize();
  }

  toggleMode() {
    this.mode = this.mode === "third" ? "first" : "third";
  }

  update(dt) {
    const g = this.game;
    const inp = g.input;
    if (this.cinematic) {
      this.cinematic.update(dt, this.cam);
      return;
    }
    const sens = g.radialOpen ? 0 : 0.0021 * (g.settings ? g.settings.sensitivity : 1) * (this.aim > 0.5 ? 0.55 : 1);
    this.yaw -= inp.mouse.dx * sens;
    this.pitch += inp.mouse.dy * sens * (g.settings && g.settings.invertY ? -1 : 1);
    this.pitch = THREE.MathUtils.clamp(this.pitch, -1.15, 1.25);
    if (inp.mouse.wheel && !g.player.weaponWheelActive) this.dist = THREE.MathUtils.clamp(this.dist + inp.mouse.wheel * 0.6, 2.2, 9);
    const p = g.player;
    const aiming = p && p.aiming;
    this.aim += ((aiming ? 1 : 0) - this.aim) * Math.min(1, dt * 10);
    const mounted = p && p.mount;
    const fovTarget = this.baseFov - this.aim * (p && p.weapon && p.weapon.kind === "gun" && !p.weapon.pistol ? 22 : 12);
    if (Math.abs(this.cam.fov - fovTarget) > 0.05) {
      this.cam.fov += (fovTarget - this.cam.fov) * Math.min(1, dt * 10);
      this.cam.updateProjectionMatrix();
    }
    const fwd = this.aimDir(tmp.clone());
    const right = new THREE.Vector3(-Math.cos(this.yaw), 0, Math.sin(this.yaw));
    if (this.mode === "first" && p) {
      const h = p.headPos(new THREE.Vector3());
      const flat = this.forward(new THREE.Vector3());
      this.pos.copy(h).addScaledVector(flat, 0.2);
      if (mounted) this.pos.y += 0.05;
      this.cam.position.copy(this.pos);
      this.look.copy(this.pos).add(fwd);
      this.cam.lookAt(this.look);
      if (p.model) p.model.visible = false;
      this.applyShake(dt);
      return;
    }
    if (p && p.model) p.model.visible = true;
    const base = mounted ? mounted.pos : p.pos;
    const pivot = new THREE.Vector3(base.x, base.y + (mounted ? 2.55 : (p.crouch ? 1.15 : 1.6)), base.z);
    const shoulder = 0.55 + this.aim * 0.2;
    const dist = THREE.MathUtils.lerp(mounted ? this.dist + 1.6 : this.dist, 1.9, this.aim);
    pivot.addScaledVector(right, shoulder);
    const want = pivot.clone().addScaledVector(fwd, -dist);
    const dir = want.clone().sub(pivot);
    const len = dir.length();
    dir.normalize();
    const terr = g.world.terrain;
    let hitT = terr.raycast(pivot, dir, len + 0.4, 0.35);
    let d = Math.min(len, hitT - 0.4);
    if (g.world.colliders) {
      const cols = g.world.colliders;
      for (let t = 0.6; t < d; t += 0.35) {
        const x = pivot.x + dir.x * t, y = pivot.y + dir.y * t, z = pivot.z + dir.z * t;
        let blocked = false;
        for (const c of cols.query(x, z, 0.3)) {
          if (y > c.y0 && y < c.y1 && cols.inside(c, x, z, 0.25)) { blocked = true; break; }
        }
        if (blocked) { d = Math.max(0.6, t - 0.35); break; }
      }
    }
    d = Math.max(0.6, d);
    const target = pivot.clone().addScaledVector(dir, d);
    const gh = terr.height(target.x, target.z) + 0.35;
    if (target.y < gh) target.y = gh;
    this.pos.lerp(target, Math.min(1, dt * 18));
    if (this.pos.distanceTo(target) > 6) this.pos.copy(target);
    this.cam.position.copy(this.pos);
    this.look.copy(pivot).addScaledVector(fwd, 8);
    this.cam.lookAt(this.look);
    this.applyShake(dt);
  }

  applyShake(dt) {
    if (this.shake > 0) {
      const s = this.shake * 0.08;
      this.cam.position.x += (Math.random() - 0.5) * s;
      this.cam.position.y += (Math.random() - 0.5) * s;
      this.shake = Math.max(0, this.shake - dt * 2.5);
    }
  }
}
