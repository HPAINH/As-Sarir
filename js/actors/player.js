import * as THREE from "three";
import { Humanoid } from "./humanoid.js";
import { WEAPONS, ARMORS, SLOT_KEYS } from "../combat/weapons.js";
import { HALF, SEA_LEVEL } from "../world/geo.js";

const WALK = 2.8, RUN = 6.4, CROUCH = 1.7;

export class Player extends Humanoid {
  constructor(game, opts) {
    super(game, { ...opts, team: "highlanders", hp: 140 });
    this.kind = "player";
    this.isPlayer = true;
    this.stamina = 100;
    this.maxStamina = 100;
    this.vy = 0;
    this.slots = opts.slots || ["saber", "kinjal", "rifle", "pistol", "bow"];
    this.slot = 0;
    this.aiming = false;
    this.drawT = 0;
    this.mouseHist = [];
    this.pendingStrike = null;
    this.mantle = null;
    this.hurtT = 0;
    this.regenT = 0;
    this.noiseT = 0;
    this.hidden = false;
    this.weaponWheelActive = false;
  }

  get state() {
    return this.game.state;
  }

  get armorDef() {
    return ARMORS[this.state.armor] || ARMORS.none;
  }

  bonus(key) {
    return this.game.peopleBonus ? this.game.peopleBonus(key) : 0;
  }

  async selectSlot(i) {
    if (i < 0 || i >= this.slots.length) return;
    const id = this.slots[i];
    if (!id || !this.state.weapons.includes(id)) return;
    if (this.reloading > 0) this.reloading = 0;
    this.slot = i;
    this.aiming = false;
    this.blocking = false;
    await this.equip(id);
    this.game.events.emit("weapon", id);
  }

  update(dt) {
    if (this.dead) return;
    const g = this.game;
    const inp = g.input;
    const rig = g.rig;
    this.attackCd = Math.max(0, this.attackCd - dt);
    this.hurtT = Math.max(0, this.hurtT - dt);
    this.noiseT = Math.max(0, this.noiseT - dt);
    this.mouseHist.push([inp.mouse.dx, inp.mouse.dy]);
    if (this.mouseHist.length > 10) this.mouseHist.shift();

    if (g.uiBlocking) {
      this.syncRoot();
      this.updateAnim(dt, 0);
      return;
    }
    if (!this.game.radialOpen) for (let i = 0; i < SLOT_KEYS.length; i++) if (inp.hit(SLOT_KEYS[i])) this.selectSlot(i);
    if (inp.mouse.wheel && inp.down("AltLeft")) {
      const owned = this.slots.map((id, i) => [id, i]).filter(([id]) => this.state.weapons.includes(id));
      const cur = owned.findIndex(([, i]) => i === this.slot);
      const nx = owned[(cur + (inp.mouse.wheel > 0 ? 1 : owned.length - 1)) % owned.length];
      if (nx) this.selectSlot(nx[1]);
    }
    if (inp.hit("KeyV")) rig.toggleMode();
    if (this.mount) {
      this.mount.riderUpdate(dt, this);
      this.updateCombat(dt, true);
      this.updateAnim(dt, 0);
      return;
    }
    if (inp.hit("KeyC")) this.crouch = !this.crouch;

    const fwd = rig.forward(new THREE.Vector3());
    const right = new THREE.Vector3(-fwd.z, 0, fwd.x);
    const move = new THREE.Vector3();
    if (inp.down("KeyW")) move.add(fwd);
    if (inp.down("KeyS")) move.sub(fwd);
    if (inp.down("KeyD")) move.add(right);
    if (inp.down("KeyA")) move.sub(right);
    const moving = move.lengthSq() > 0.01;
    if (moving) move.normalize();
    const armor = this.armorDef;
    let sprint = inp.down("ShiftLeft") && moving && !this.crouch && this.stamina > 2 && !this.aiming && !this.blocking;
    let speed = this.crouch ? CROUCH : sprint ? RUN : WALK;
    speed *= armor.speed;
    if (this.bonus("forest_speed") && g.world.isForest && g.world.isForest(this.pos.x, this.pos.z)) speed *= 1.1;
    if (this.aiming || this.blocking) speed = Math.min(speed, WALK * 0.7);
    if (this.reloading > 0) speed = Math.min(speed, WALK * 0.55);
    const terr = g.world.terrain;
    const slopeN = terr.normal(this.pos.x, this.pos.z);
    const uphill = moving ? -(slopeN.x * move.x + slopeN.z * move.z) : 0;
    if (uphill > 0.05) {
      const drain = (1 - this.bonus("climb_stamina")) / armor.climb;
      if (sprint) this.stamina -= uphill * 18 * dt * drain;
      speed *= Math.max(0.35, 1 - uphill * 0.9);
    }
    if (sprint) this.stamina -= 13 * dt;
    else this.stamina += (moving ? 14 : 22) * dt;
    this.stamina = THREE.MathUtils.clamp(this.stamina, 0, this.maxStamina);

    const tvx = move.x * speed, tvz = move.z * speed;
    const acc = this.grounded ? 14 : 3;
    this.vel.x += (tvx - this.vel.x) * Math.min(1, acc * dt);
    this.vel.z += (tvz - this.vel.z) * Math.min(1, acc * dt);

    const facing = this.aiming || this.blocking || this.attackCd > 0 || this.reloading > 0 || g.rig.mode === "first";
    if (facing) this.yaw = turnTo(this.yaw, rig.yaw, dt * 14);
    else if (moving) this.yaw = turnTo(this.yaw, Math.atan2(move.x, move.z), dt * 10);

    if (this.mantle) {
      const m = this.mantle;
      m.t += dt / m.dur;
      const t = Math.min(1, m.t);
      this.pos.lerpVectors(m.from, m.to, t);
      this.pos.y = m.from.y + (m.to.y - m.from.y) * Math.min(1, t * 1.6);
      if (t >= 1) { this.mantle = null; this.vy = 0; }
      this.vel.set(0, 0, 0);
    } else {
      if (inp.hit("Space")) this.tryJump(move);
      const nx = this.pos.x + this.vel.x * dt, nz = this.pos.z + this.vel.z * dt;
      const hNow = this.groundHeight(this.pos.x, this.pos.z), hNext = this.groundHeight(nx, nz);
      const rise = hNext - hNow;
      const stepLen = Math.hypot(nx - this.pos.x, nz - this.pos.z);
      const steep = stepLen > 1e-4 && rise / stepLen > 1.35 && rise > 0.2;
      const deepWater = terr.height(nx, nz) < SEA_LEVEL - 1.4;
      if (!steep && !deepWater) { this.pos.x = nx; this.pos.z = nz; }
      else { this.vel.x *= 0.2; this.vel.z *= 0.2; }
      this.pos.x = THREE.MathUtils.clamp(this.pos.x, -HALF + 5, HALF - 5);
      this.pos.z = THREE.MathUtils.clamp(this.pos.z, -HALF + 5, HALF - 5);
      g.world.colliders.resolve(this.pos, this.radius, this.pos.y, this.crouch ? 1.2 : 1.8);
      this.vy -= 22 * dt;
      this.pos.y += this.vy * dt;
      const gh = this.groundHeight(this.pos.x, this.pos.z);
      if (this.pos.y <= gh) {
        if (!this.grounded && this.vy < -14) this.game.combat && this.game.combat.damage(this, null, (-this.vy - 14) * 9, { type: "fall" });
        this.pos.y = gh;
        this.vy = 0;
        this.grounded = true;
      } else if (this.pos.y - gh > 0.25) {
        this.grounded = false;
      } else {
        this.pos.y = gh;
        this.vy = Math.min(this.vy, 0);
        this.grounded = true;
      }
      const water = terr.height(this.pos.x, this.pos.z) < SEA_LEVEL - 0.7;
      this.inWater = water;
    }
    this.updateCombat(dt, false);
    const hs = Math.hypot(this.vel.x, this.vel.z);
    if (!this.oneShot || this.oneShot.interruptible) {
      if (this.crouch) this.loop("Crouch", 0.25, 1);
      else if (this.aiming && this.weapon && this.weapon.kind === "bow") this.loop("Idle");
      else if (hs > 4.2) this.loop("Run", 0.2, hs / 3.9);
      else if (hs > 0.5) this.loop("Walk", 0.2, hs / 1.35);
      else this.loop("Idle", 0.3);
    } else if (this.current) {
      const want = this.crouch ? "Crouch" : hs > 4.2 ? "Run" : hs > 0.5 ? "Walk" : "Idle";
      this.current = { name: want, action: this.actions[want] };
    }
    if (this.aiming && this.weapon && this.weapon.kind === "gun") this.holdPose("Aim_Rifle", 0.33);
    if (this.aiming && this.weapon && this.weapon.kind === "bow") this.holdPose("Aim_Bow", 0.4);
    if (this.blocking) this.holdPose("Block", 0.3);
    this.syncRoot();
    this.updateAnim(dt, 0);
  }

  holdPose(name, t) {
    const a = this.actions[name];
    if (!a) return;
    if (!this.oneShot || this.oneShot.name !== name) this.play(name, { fade: 0.15, interruptible: true });
    if (a.time > t) a.time = t;
  }

  groundHeight(x, z) {
    const w = this.game.world;
    const th = w.terrain.height(x, z);
    return w.colliders.groundAt(x, z, this.pos.y, th)[0];
  }

  tryJump(move) {
    const cols = this.game.world.colliders;
    const ahead = this.forward(new THREE.Vector3());
    const reach = 2.4 * (this.state.skills && this.state.skills.climb ? 1.25 : 1) * (this.bonus("climb_speed") ? 1.1 : 1);
    const ax = this.pos.x + ahead.x * 0.9, az = this.pos.z + ahead.z * 0.9;
    const c = cols.climbable(ax, az, this.pos.y, reach);
    const th = this.game.world.terrain.height(ax, az);
    let top = c ? c.y1 : null;
    if (!top && th - this.pos.y > 0.6 && th - this.pos.y < reach * 0.8) top = th;
    if (top !== null && this.stamina > 8) {
      const to = new THREE.Vector3(this.pos.x + ahead.x * 1.3, top, this.pos.z + ahead.z * 1.3);
      this.mantle = { from: this.pos.clone(), to, t: 0, dur: 0.55 + (top - this.pos.y) * 0.18 };
      this.stamina -= 8 / (this.armorDef.climb || 1);
      this.play("Block", { fade: 0.08, speed: 1.2 });
      return;
    }
    if (this.grounded && this.stamina > 10) {
      this.vy = 6.6;
      this.grounded = false;
      this.stamina -= 10;
    }
  }

  strikeKind() {
    let sx = 0, sy = 0;
    for (const [x, y] of this.mouseHist) { sx += Math.abs(x); sy += y; }
    if (this.weapon && this.weapon.thrust) return "thrust";
    return Math.abs(sy) > sx * 1.1 && Math.abs(sy) > 6 ? "thrust" : "slash";
  }

  updateCombat(dt, mounted) {
    const g = this.game;
    const inp = g.input;
    const w = this.weapon;
    const C = g.combat;
    if (!w || !C) { this.aiming = false; return; }
    if (this.pendingStrike) {
      this.pendingStrike.t -= dt;
      if (this.pendingStrike.t <= 0) {
        const ps = this.pendingStrike;
        this.pendingStrike = null;
        C.melee(this, w, ps.kind);
      }
    }
    if (w.kind === "melee") {
      this.aiming = false;
      this.blocking = inp.button(2) && !mounted && this.stamina > 3;
      if (inp.click(0) && this.attackCd <= 0 && this.stamina >= 6 && !this.blocking) {
        const stealthTarget = C.stealthTarget(this);
        if (stealthTarget && w.stealth) {
          C.stealthKill(this, stealthTarget);
          this.attackCd = 1.1;
          return;
        }
        const kind = mounted ? "slash" : this.strikeKind();
        const clip = kind === "thrust" ? "Attack_Thrust" : "Attack_Slash";
        const speed = 1 + (this.state.skills.combo ? 0.15 : 0);
        this.play(clip, { fade: 0.08, speed });
        this.pendingStrike = { t: (kind === "thrust" ? 0.37 : 0.43) / speed, kind };
        this.attackCd = w.cd / speed;
        this.stamina -= kind === "thrust" ? 7 : 9;
        g.audio && g.audio.swing(this.pos);
      }
      return;
    }
    if (w.kind === "gun") {
      this.blocking = false;
      if (this.reloading > 0) {
        this.aiming = false;
        this.reloading -= dt;
        if (!this.oneShot || this.oneShot.name !== "Reload") this.play("Reload", { fade: 0.15, speed: 0.95 });
        if (this.reloading <= 0) {
          this.reloading = 0;
          this.loaded[w.id] = true;
          g.events.emit("reloaded", w.id);
        }
        return;
      }
      this.aiming = inp.button(2) || (mounted && inp.button(0) && false);
      if (inp.hit("KeyR")) this.startReload();
      if (inp.click(0) && this.attackCd <= 0) {
        if (!this.loaded[w.id]) {
          if (!this.startReload()) g.ui && g.ui.toast("Нет пороха или свинца");
          return;
        }
        this.loaded[w.id] = false;
        this.attackCd = 0.5;
        const misfire = g.world.sky.weather === "rain" && Math.random() < 0.2;
        if (misfire) {
          g.ui && g.ui.toast("Осечка: порох отсырел");
          g.audio && g.audio.click(this.pos);
          return;
        }
        this.play("Fire_Rifle", { fade: 0.05 });
        const dir = g.rig.aimDir(new THREE.Vector3());
        const origin = g.rig.cam.position.clone();
        let spread = w.spread * (this.aiming ? 1 : 4) * (this.state.skills.steady && this.aiming && this.crouch ? 0.5 : 1);
        if (Math.hypot(this.vel.x, this.vel.z) > 1) spread *= 2.2;
        if (mounted) spread *= 1.8;
        C.fire(this, w, origin, dir, spread);
        g.rig.shake = Math.max(g.rig.shake, w.pistol ? 0.35 : 0.6);
        this.noiseT = 3;
      }
      return;
    }
    if (w.kind === "bow") {
      this.blocking = false;
      const has = (this.state.res.arrows || 0) > 0;
      this.aiming = inp.button(2) && has;
      if (this.aiming) this.drawT += dt; else this.drawT = 0;
      if (inp.click(0) && this.attackCd <= 0) {
        if (!has) { g.ui && g.ui.toast("Нет стрел"); return; }
        if (!this.aiming || this.drawT < 0.45) return;
        const dir = g.rig.aimDir(new THREE.Vector3());
        const origin = this.chestPos(new THREE.Vector3()).addScaledVector(dir, 0.6);
        origin.y += 0.25;
        const camPos = g.rig.cam.position.clone();
        const aimPoint = camPos.clone().addScaledVector(dir, 60);
        const adir = aimPoint.sub(origin).normalize();
        C.arrow(this, w, origin, adir, Math.min(1, this.drawT / 1.0));
        this.state.res.arrows--;
        this.attackCd = w.cd;
        this.drawT = 0;
      }
    }
  }

  startReload() {
    const w = this.weapon;
    if (!w || w.kind !== "gun" || this.loaded[w.id] || this.reloading > 0) return false;
    const r = this.state.res;
    if ((r.powder || 0) < 1 || (r.lead || 0) < 1) return false;
    r.powder--; r.lead--;
    let t = w.reload * (this.state.skills.fastReload ? 0.7 : 1);
    if (this.mount) t *= 1.3;
    this.reloading = t;
    this.aiming = false;
    return true;
  }
}

export function turnTo(a, b, k) {
  let d = b - a;
  while (d > Math.PI) d -= Math.PI * 2;
  while (d < -Math.PI) d += Math.PI * 2;
  return a + d * Math.min(1, k);
}
