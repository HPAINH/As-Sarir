import * as THREE from "three";
import { Humanoid } from "./humanoid.js";
import { WEAPONS } from "../combat/weapons.js";
import { SEA_LEVEL, HALF } from "../world/geo.js";
import { turnTo } from "./player.js";
import { Brain } from "../ai/brain.js";

const SPEEDS = { walk: 1.7, run: 4.4, sprint: 5.9 };
const tmp = new THREE.Vector3();

export class NPC extends Humanoid {
  constructor(game, unitId, def, opts = {}) {
    let model = def.model;
    if (model === "people") model = (game.data.peoples[opts.people || game.state.people] || {}).model || "characters/villager_man";
    if (opts.model) model = opts.model;
    super(game, { model, team: opts.team || def.team, hp: opts.hp || def.hp, name: opts.name || def.name, tags: opts.tags });
    this.kind = "npc";
    this.unitId = unitId;
    this.def = def;
    this.role = opts.role || def.role;
    this.armorDef = def.armor || 0;
    this.acc = def.acc || 0.5;
    this.persistent = !!opts.persistent;
    this.origin = opts.origin || null;
    this.group = null;
    this.people = opts.people || null;
    this.primary = opts.weapon || def.weapon || null;
    this.meleeW = def.melee || (WEAPONS[this.primary] && WEAPONS[this.primary].kind === "melee" ? this.primary : null);
    this.rangedW = def.ranged || null;
    this.aimT = 0;
    this.strike = null;
    this.desired = new THREE.Vector3();
    this.stuck = 0;
    this.lastPos = new THREE.Vector3();
    this.talk = opts.talk || null;
    this.essential = !!opts.essential;
    this.torch = !!opts.torch;
    this.horse = null;
    this.camel = null;
    this.speedMul = 1;
  }

  async init() {
    await super.init();
    const s = this.def.scale || 1;
    if (s !== 1) this.model.scale.setScalar(s);
    if (this.def.tint) {
      const t = new THREE.Color(...this.def.tint);
      this.model.traverse(o => {
        if (o.isMesh || o.isSkinnedMesh) {
          o.material = Array.isArray(o.material) ? o.material.map(m => m.clone()) : o.material.clone();
          const mats = Array.isArray(o.material) ? o.material : [o.material];
          for (const m of mats) if (m.color) m.color.multiply(t);
        }
      });
    }
    if (this.primary) {
      await this.equip(this.primary);
      for (const w of [this.primary, this.rangedW]) if (w && WEAPONS[w] && WEAPONS[w].kind === "gun") this.loaded[w] = true;
    }
    this.brain = new Brain(this);
    return this;
  }

  get mounted() {
    return !!this.mount;
  }

  speedFor(mode) {
    return (SPEEDS[mode] || SPEEDS.walk) * (this.def.speed || 1) * this.speedMul;
  }

  probe(x, z, maxRise = 1.3) {
    const w = this.game.world;
    const terr = w.terrain;
    if (Math.abs(x) > HALF - 6 || Math.abs(z) > HALF - 6) return false;
    if (terr.height(x, z) < SEA_LEVEL - 1.0) return false;
    const h0 = w.colliders.groundAt(this.pos.x, this.pos.z, this.pos.y, terr.height(this.pos.x, this.pos.z))[0];
    const h1 = w.colliders.groundAt(x, z, this.pos.y + 0.5, terr.height(x, z))[0];
    const d = Math.hypot(x - this.pos.x, z - this.pos.z) || 1;
    if ((h1 - h0) / d > maxRise && h1 - h0 > 0.3) return false;
    for (const c of w.colliders.query(x, z, 0.5)) {
      if (c.type === "grid") {
        const k = w.colliders.gridCell(c, x, z);
        if (k >= 0) {
          const top = c.baseY + c.g.h[k], lo = c.baseY + c.g.lo[k];
          if (top > this.pos.y + 0.8 && lo < this.pos.y + 1.7) return false;
        }
      } else if (w.colliders.inside(c, x, z, this.radius) && c.y1 > this.pos.y + 0.8 && c.y0 < this.pos.y + 1.7) return false;
    }
    return true;
  }

  moveTo(x, z, mode = "walk", dt, stopDist = 0.6) {
    if (this.mount) {
      const sp = mode === "sprint" ? this.mount.breed.speed : mode === "run" ? this.mount.breed.speed * 0.6 : 2.5;
      const d = Math.hypot(x - this.pos.x, z - this.pos.z);
      this.mount.steer({ x, z }, d < stopDist + 2 ? 0 : sp, dt);
      return d;
    }
    const dx = x - this.pos.x, dz = z - this.pos.z;
    const dist = Math.hypot(dx, dz);
    if (dist < stopDist) { this.stop(dt); return dist; }
    let want = Math.atan2(dx, dz);
    const look = Math.min(2.2, dist);
    const tryAngles = [0, 0.5, -0.5, 1.0, -1.0, 1.6, -1.6, 2.4, -2.4];
    let ok = false;
    for (const off of tryAngles) {
      const a = want + off + (this.sideBias || 0) * (off !== 0 ? 1 : 0);
      if (this.probe(this.pos.x + Math.sin(a) * look, this.pos.z + Math.cos(a) * look)) {
        want = a;
        ok = true;
        if (off !== 0) this.sideBias = Math.sign(off) * 0.1;
        break;
      }
    }
    if (!ok) { this.stuck += dt; this.stop(dt); return dist; }
    this.yaw = turnTo(this.yaw, want, dt * 7);
    const sp = this.speedFor(mode);
    this.vel.x += (Math.sin(this.yaw) * sp - this.vel.x) * Math.min(1, dt * 8);
    this.vel.z += (Math.cos(this.yaw) * sp - this.vel.z) * Math.min(1, dt * 8);
    return dist;
  }

  stop(dt) {
    if (this.mount) { this.mount.targetSpeed = 0; this.mount.speed *= 0.9; return; }
    this.vel.x *= Math.max(0, 1 - dt * 10);
    this.vel.z *= Math.max(0, 1 - dt * 10);
  }

  face(p, dt, k = 8) {
    const want = Math.atan2(p.x - this.pos.x, p.z - this.pos.z);
    if (this.mount) return;
    this.yaw = turnTo(this.yaw, want, dt * k);
  }

  facing(p, cosLimit = 0.8) {
    const dx = p.x - this.pos.x, dz = p.z - this.pos.z;
    const l = Math.hypot(dx, dz) || 1;
    return (dx / l) * Math.sin(this.yaw) + (dz / l) * Math.cos(this.yaw) > cosLimit;
  }

  physics(dt) {
    if (this.mount) return;
    const w = this.game.world;
    this.pos.x += this.vel.x * dt;
    this.pos.z += this.vel.z * dt;
    w.colliders.resolve(this.pos, this.radius, this.pos.y, 1.8);
    for (const o of this.game.actors.near(this.pos.x, this.pos.z, 1.2)) {
      if (o === this || o.dead || o.kind === "horse" && o.rider) continue;
      const dx = this.pos.x - o.pos.x, dz = this.pos.z - o.pos.z;
      const d = Math.hypot(dx, dz);
      const m = (this.radius + (o.radius || 0.4)) * 0.9;
      if (d < m && d > 1e-4) {
        this.pos.x += dx / d * (m - d) * 0.5;
        this.pos.z += dz / d * (m - d) * 0.5;
      }
    }
    const g = w.colliders.groundAt(this.pos.x, this.pos.z, this.pos.y, w.terrain.height(this.pos.x, this.pos.z))[0];
    if (g < this.pos.y - 0.6) this.pos.y += (g - this.pos.y) * Math.min(1, dt * 6);
    else this.pos.y = g;
    if (Math.hypot(this.pos.x - this.lastPos.x, this.pos.z - this.lastPos.z) < 0.02 && Math.hypot(this.vel.x, this.vel.z) > 0.8) this.stuck += dt;
    else this.stuck = Math.max(0, this.stuck - dt);
    this.lastPos.copy(this.pos);
  }

  animate() {
    if (this.dead || this.mount) return;
    if (this.oneShot && !this.oneShot.interruptible) {
      const hs = Math.hypot(this.vel.x, this.vel.z);
      const want = this.crouch ? "Crouch" : hs > 3 ? "Run" : hs > 0.4 ? "Walk" : this.idleClip || "Idle";
      this.current = { name: want, action: this.actions[want] };
      return;
    }
    const hs = Math.hypot(this.vel.x, this.vel.z);
    if (this.crouch) this.loop("Crouch", 0.3);
    else if (hs > 3.2) this.loop("Run", 0.2, hs / 3.9);
    else if (hs > 0.35) this.loop("Walk", 0.2, Math.max(0.7, hs / 1.35));
    else this.loop(this.idleClip || "Idle", 0.3);
  }

  holdPose(name, t) {
    const a = this.actions[name];
    if (!a) return;
    if (!this.oneShot || this.oneShot.name !== name) this.play(name, { fade: 0.15, interruptible: true });
    if (a.time > t) a.time = t;
  }

  async setWeapon(id) {
    if (!id || this.heldId === id) return;
    await this.equip(id);
  }

  meleeAttack(target) {
    const w = WEAPONS[this.meleeW || this.heldId];
    if (!w || this.attackCd > 0 || this.strike) return false;
    if (this.heldId !== w.id) { this.setWeapon(w.id); this.attackCd = 0.4; return false; }
    const thrust = w.thrust || Math.random() < 0.35;
    this.play(thrust ? "Attack_Thrust" : "Attack_Slash", { fade: 0.1 });
    this.strike = { t: thrust ? 0.37 : 0.43, kind: thrust ? "thrust" : "slash", w };
    this.attackCd = w.cd * (1.4 + Math.random() * 0.9) / (this.def.boss ? 1.3 : 1);
    return true;
  }

  canShoot() {
    const id = this.rangedW && (!this.mount || WEAPONS[this.rangedW].kind !== "gun" || WEAPONS[this.rangedW].pistol) ? this.rangedW : null;
    const pid = this.primary && WEAPONS[this.primary] && WEAPONS[this.primary].kind !== "melee" ? this.primary : null;
    return id || pid;
  }

  shootAt(target, dt) {
    const g = this.game;
    const wid = this.canShoot();
    if (!wid) return "none";
    const w = WEAPONS[wid];
    if (this.heldId !== wid) { this.setWeapon(wid); return "switch"; }
    if (w.kind === "gun" && !this.loaded[wid]) return "empty";
    this.face(target.pos, dt, 10);
    this.aimT += dt;
    if (!this.mount) this.holdPose(w.kind === "bow" ? "Aim_Bow" : "Aim_Rifle", w.kind === "bow" ? 0.4 : 0.33);
    const need = (w.kind === "bow" ? 0.9 : 1.0) * (1.6 - this.acc * 0.6) * (this.volleyHold ? 9 : 1);
    if (this.aimT < need) return "aiming";
    if (this.volleyHold) return "aiming";
    this.aimT = 0;
    const muzzle = this.chestPos(new THREE.Vector3());
    muzzle.y += 0.25;
    const aimPt = target.chestPos ? target.chestPos(new THREE.Vector3()) : target.pos.clone().setY(target.pos.y + 1);
    const tv = target.vel || new THREE.Vector3();
    const d = muzzle.distanceTo(aimPt);
    const lead = w.kind === "bow" ? d / w.speed : 0;
    aimPt.addScaledVector(tv, lead * 0.8);
    if (w.kind === "bow") aimPt.y += d * d * 0.5 * 9.8 / (w.speed * w.speed);
    const dir = aimPt.sub(muzzle).normalize();
    let spread = (1.15 - this.acc) * 0.05 + Math.min(0.05, Math.hypot(tv.x, tv.z) * 0.006);
    if (d > 40) spread += (d - 40) * 0.0002;
    if (g.world.sky.isNight) spread *= 1.6;
    if (target.crouch) spread *= 1.2;
    if (this.mount) spread *= 1.5;
    if (w.kind === "gun") {
      if (g.world.sky.weather === "rain" && Math.random() < 0.2) { this.loaded[wid] = false; return "misfire"; }
      this.loaded[wid] = false;
      if (!this.mount) this.play("Fire_Rifle", { fade: 0.05 });
      g.combat.fire(this, w, muzzle, dir, spread);
    } else {
      g.combat.arrow(this, w, muzzle, dir, 0.9, spread);
    }
    return "fired";
  }

  reloadStep(dt) {
    const wid = this.canShoot();
    if (!wid) return true;
    const w = WEAPONS[wid];
    if (w.kind !== "gun" || this.loaded[wid]) return true;
    if (this.reloading <= 0) this.reloading = w.reload * (1.0 + Math.random() * 0.25) * (this.mount ? 1.4 : 1);
    this.reloading -= dt;
    if (!this.mount && (!this.oneShot || this.oneShot.name !== "Reload")) this.play("Reload", { fade: 0.15, speed: 0.95, interruptible: true });
    if (this.reloading <= 0) {
      this.reloading = 0;
      this.loaded[wid] = true;
      return true;
    }
    return false;
  }

  update(dt) {
    if (this.dead) {
      this.updateAnim(dt, this.game.engine.camera.position.distanceTo(this.pos));
      return;
    }
    this.attackCd = Math.max(0, this.attackCd - dt);
    if (this.strike) {
      this.strike.t -= dt;
      if (this.strike.t <= 0) {
        const s = this.strike;
        this.strike = null;
        this.game.combat.melee(this, s.w, s.kind);
      }
    }
    const camD = this.game.engine.camera.position.distanceTo(this.pos);
    this.brain.update(dt, camD);
    this.physics(dt);
    this.animate();
    if (!this.mount) this.syncRoot();
    this.updateAnim(dt, camD);
    if (this.torch && this.game.world.sky.isNight && camD < 120) {
      const h = this.hand ? this.hand.getWorldPosition(tmp) : tmp.copy(this.pos).setY(this.pos.y + 1.6);
      this.game.effects.torch(h);
    }
  }
}
