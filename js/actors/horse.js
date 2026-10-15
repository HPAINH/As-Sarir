import * as THREE from "three";
import { Actor } from "./humanoid.js";
import { SEA_LEVEL, HALF } from "../world/geo.js";
import { turnTo } from "./player.js";

export const BREEDS = {
  mountain: { id: "mountain", name: "Горная", model: "animals/horse_bay", speed: 11.5, slope: 0.72, stamina: 140, hp: 220 },
  karabakh: { id: "karabakh", name: "Карабахская", model: "animals/horse_black_saddled", speed: 14.5, slope: 0.52, stamina: 100, hp: 200 },
  persian: { id: "persian", name: "Персидская трофейная", model: "animals/horse_grey_persian", speed: 13, slope: 0.42, stamina: 115, hp: 260 },
};

const tmp = new THREE.Vector3();

export class Quadruped extends Actor {
  constructor(game, opts = {}) {
    super(game, opts);
    this.kind = "animal";
    this.modelPath = opts.model;
    this.radius = opts.radius || 0.7;
    this.height = opts.height || 1.6;
    this.speed = 0;
    this.targetSpeed = 0;
    this.moveDir = new THREE.Vector3(0, 0, 1);
  }

  async init() {
    const { scene, animations } = await this.game.assets.instance(this.modelPath);
    this.setModel(scene, animations);
    scene.traverse(o => { if (o.isMesh || o.isSkinnedMesh) { o.castShadow = true; o.frustumCulled = false; } });
    this.saddle = scene.getObjectByName("Saddle");
    this.headBone = scene.getObjectByName("Head");
    this.loop("Idle", 0);
    return this;
  }

  groundAt(x, z) {
    const w = this.game.world;
    return w.colliders.groundAt(x, z, this.pos.y, w.terrain.height(x, z), 0.9)[0];
  }

  canStep(nx, nz, maxSlope) {
    const terr = this.game.world.terrain;
    const h0 = this.groundAt(this.pos.x, this.pos.z), h1 = this.groundAt(nx, nz);
    const d = Math.hypot(nx - this.pos.x, nz - this.pos.z) || 1e-4;
    if ((h1 - h0) / d > maxSlope * 1.8 && h1 - h0 > 0.15) return false;
    if (terr.height(nx, nz) < SEA_LEVEL - 1.1) return false;
    if (Math.abs(nx) > HALF - 6 || Math.abs(nz) > HALF - 6) return false;
    return true;
  }

  physics(dt, maxSlope = 0.8) {
    const nx = this.pos.x + Math.sin(this.yaw) * this.speed * dt;
    const nz = this.pos.z + Math.cos(this.yaw) * this.speed * dt;
    if (this.canStep(nx, nz, maxSlope)) { this.pos.x = nx; this.pos.z = nz; }
    else { this.speed *= 0.3; this.blocked = (this.blocked || 0) + dt; }
    this.game.world.colliders.resolve(this.pos, this.radius, this.pos.y, this.height, 0.9);
    const g = this.groundAt(this.pos.x, this.pos.z);
    this.pos.y += (g - this.pos.y) * Math.min(1, dt * 12);
    if (Math.abs(g - this.pos.y) > 3) this.pos.y = g;
  }

  animate() {
    if (this.dead) return;
    if (this.oneShot && !this.oneShot.interruptible) return;
    const s = Math.abs(this.speed);
    if (s < 0.25) this.loop(this.grazing && this.has("Graze") ? "Graze" : "Idle", 0.3);
    else if (s < 4.5) this.loop("Walk", 0.25, Math.max(0.6, s / 1.7));
    else this.loop("Run", 0.25, Math.max(0.8, s / 9));
  }
}

export class Horse extends Quadruped {
  constructor(game, opts = {}) {
    const breed = BREEDS[opts.breed] || BREEDS.mountain;
    super(game, { ...opts, model: breed.model, hp: opts.hp || breed.hp, radius: 0.75, height: 1.9 });
    this.kind = "horse";
    this.breed = breed;
    this.rider = null;
    this.owner = opts.owner || null;
    this.stamina = breed.stamina;
    this.team = opts.team || "neutral";
    this.trampleCd = new Map();
    this.called = false;
    this.name = opts.name || "Конь";
  }

  mountPoint(out = new THREE.Vector3()) {
    if (this.saddle) {
      this.root.updateMatrixWorld(true);
      return this.saddle.getWorldPosition(out);
    }
    return out.copy(this.pos).setY(this.pos.y + 1.6);
  }

  mount(r) {
    if (this.rider || this.dead) return false;
    this.rider = r;
    r.mount = this;
    r.crouch = false;
    r.blocking = false;
    r.loop("Ride", 0.2);
    this.speed = 0;
    if (r.isPlayer) this.game.events.emit("mounted", this);
    return true;
  }

  dismount() {
    const r = this.rider;
    if (!r) return;
    this.rider = null;
    r.mount = null;
    const side = new THREE.Vector3(Math.cos(this.yaw), 0, -Math.sin(this.yaw));
    let px = this.pos.x - side.x * 1.4, pz = this.pos.z - side.z * 1.4;
    r.pos.set(px, this.game.world.ground(px, pz, this.pos.y + 2), pz);
    r.vel.set(0, 0, 0);
    r.loop("Idle", 0.2);
    r.dismountedAt = this.game.engine.time;
    if (r.isPlayer) this.game.events.emit("dismounted", this);
  }

  syncRider(dt) {
    const r = this.rider;
    if (!r) return;
    const mp = this.mountPoint(tmp);
    r.pos.set(mp.x, mp.y - 0.93, mp.z);
    r.yaw = this.yaw;
    if (!r.oneShot || r.oneShot.interruptible) r.loop("Ride", 0.2, this.speed > 6 ? 1.6 : this.speed > 1 ? 1.1 : 0.5);
    r.syncRoot();
  }

  riderUpdate(dt, p) {
    const g = this.game;
    const inp = g.input;
    if (this.dead) { this.dismount(); return; }
    if (inp.hit("KeyF") || inp.hit("KeyE")) { this.dismount(); return; }
    const plain = g.peopleBonus("cav_plain") && this.pos.y < 40 ? 1 + g.peopleBonus("cav_plain") : 1;
    const fwd = inp.down("KeyW"), back = inp.down("KeyS");
    const sprint = inp.down("ShiftLeft") && this.stamina > 5;
    const items = g.state.items;
    let top = this.breed.speed * plain * (items.includes("shamkhal_saddle") ? 1.08 : items.includes("persian_saddle") ? 1.05 : 1);
    if (fwd) this.targetSpeed = sprint ? top : top * 0.55;
    else if (back) this.targetSpeed = -1.8;
    else this.targetSpeed = 0;
    if (p.aiming) this.targetSpeed = Math.min(this.targetSpeed, top * 0.3);
    const turn = (inp.down("KeyA") ? 1 : 0) - (inp.down("KeyD") ? 1 : 0);
    const rate = 2.2 - Math.min(1.2, Math.abs(this.speed) / 12);
    if (turn) this.yaw += turn * rate * dt;
    else if (fwd && g.rig.mode === "first") this.yaw = turnTo(this.yaw, g.rig.yaw, dt * 1.5);
    else if (fwd && Math.abs(this.speed) > 1) this.yaw = turnTo(this.yaw, g.rig.yaw, dt * 0.9);
    const ahead = this.forward(new THREE.Vector3());
    const nrm = g.world.terrain.normal(this.pos.x + ahead.x * 3, this.pos.z + ahead.z * 3);
    const uphill = -(nrm.x * ahead.x + nrm.z * ahead.z);
    if (uphill > this.breed.slope) this.targetSpeed = Math.min(this.targetSpeed, 2.5);
    if (uphill > this.breed.slope + 0.25) this.targetSpeed = Math.min(this.targetSpeed, 0);
    const acc = this.targetSpeed > this.speed ? 5 : 9;
    this.speed += (this.targetSpeed - this.speed) * Math.min(1, acc * dt);
    if (sprint && this.speed > top * 0.7) this.stamina -= 12 * dt;
    else this.stamina = Math.min(this.breed.stamina, this.stamina + (8 + 8 * g.peopleBonus("horse_regen")) * dt);
    if (inp.hit("Space") && this.speed > 3 && this.grounded !== false) this.jumpT = 0.6;
    this.physics(dt, this.breed.slope + 0.3);
    if (this.jumpT > 0) {
      this.jumpT -= dt;
      this.pos.y += Math.sin((0.6 - this.jumpT) / 0.6 * Math.PI) * 1.1;
    }
    if (this.speed > 9) this.trample(dt);
    this.animate();
    this.syncRoot();
    this.updateAnim(dt, 0);
    this.syncRider(dt);
    g.rig.yawFollow = this.yaw;
  }

  trample(dt) {
    const g = this.game;
    const f = this.forward(new THREE.Vector3());
    for (const a of g.actors.near(this.pos.x, this.pos.z, 2.6)) {
      if (a === this || a === this.rider || a.dead || a.kind === "horse") continue;
      if (this.rider && !g.combat.hostile(this.rider, a)) continue;
      const dx = a.pos.x - this.pos.x, dz = a.pos.z - this.pos.z;
      if (dx * f.x + dz * f.z < 0.3) continue;
      const last = this.trampleCd.get(a.id) || 0;
      if (g.engine.time - last < 1.2) continue;
      this.trampleCd.set(a.id, g.engine.time);
      g.combat.damage(a, this.rider, 22 + this.speed * 1.2, { type: "trample", dir: f });
    }
  }

  steer(target, speed, dt) {
    const dx = target.x - this.pos.x, dz = target.z - this.pos.z;
    const want = Math.atan2(dx, dz);
    this.yaw = turnTo(this.yaw, want, dt * 2.6);
    this.targetSpeed = speed;
    this.speed += (this.targetSpeed - this.speed) * Math.min(1, dt * 3);
  }

  update(dt) {
    if (this.rider && this.rider.isPlayer) return;
    if (this.dead) { this.updateAnim(dt, 30); return; }
    const g = this.game;
    if (!this.rider) {
      if (this.called && this.owner) {
        const d = this.distTo(this.owner);
        if (d > 3.5) this.steer(this.owner.pos, d > 25 ? 12 : 4, dt);
        else { this.called = false; this.targetSpeed = 0; this.speed *= 0.5; }
      } else {
        this.speed += (0 - this.speed) * Math.min(1, dt * 2);
        this.grazing = true;
      }
      this.physics(dt, this.breed.slope + 0.2);
    } else {
      this.physics(dt, this.breed.slope + 0.2);
      if (this.speed > 9) this.trample(dt);
    }
    this.animate();
    this.syncRoot();
    const cd = this.game.engine.camera.position.distanceTo(this.pos);
    this.updateAnim(dt, cd);
    this.syncRider(dt);
  }
}

export class Animal extends Quadruped {
  constructor(game, unitId, def, opts = {}) {
    super(game, { ...opts, model: def.animal, hp: def.hp, radius: unitId === "bear" ? 0.8 : 0.5, height: unitId === "bear" ? 1.3 : 1.0, name: def.name });
    this.unitId = unitId;
    this.def = def;
    this.team = def.team;
    this.kind = "animal";
    this.role = def.role;
    this.camel = unitId === "camel";
  }

  update(dt) {
    const cd = this.game.engine.camera.position.distanceTo(this.pos);
    if (this.dead) { this.updateAnim(dt, cd); return; }
    if (this.brain) this.brain.update(dt);
    else this.speed *= 0.9;
    this.physics(dt, 0.9);
    this.animate();
    this.syncRoot();
    this.updateAnim(dt, cd);
  }
}
