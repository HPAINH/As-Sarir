import * as THREE from "three";
import { WEAPONS } from "../combat/weapons.js";

let GROUP_ID = 1;
const tmpA = new THREE.Vector3(), tmpB = new THREE.Vector3();

export class Group {
  constructor(team, opts = {}) {
    this.id = GROUP_ID++;
    this.team = team;
    this.members = [];
    this.officer = null;
    this.initial = 0;
    this.alerted = false;
    this.hornAt = -1;
    this.hornDone = false;
    this.anchor = new THREE.Vector3(...(opts.anchor || [0, 0, 0]));
    this.patrol = opts.patrol || null;
    this.patrolI = 0;
    this.kind = opts.kind || "garrison";
    this.tag = opts.tag || null;
    this.volleyGo = 0;
    this.volleyWait = 0;
    this.order = opts.order || null;
    this.target = null;
    this.reinforce = opts.reinforce !== false;
    this.onWiped = null;
    this.broken = false;
  }

  add(n) {
    this.members.push(n);
    n.group = this;
    this.initial++;
    if (n.role === "officer" || (n.def && n.def.boss)) this.officer = this.officer || n;
  }

  get alive() {
    return this.members.filter(m => !m.dead);
  }

  alert(target, by) {
    if (!this.alerted) {
      this.alerted = true;
      if (this.officer && !this.officer.dead && this.reinforce) this.hornAt = by.game.engine.time + 3 + Math.random() * 3;
    }
    this.target = target;
    for (const m of this.alive) if (m.brain && m.brain.state !== "combat" && m.brain.state !== "script" && m.brain.state !== "flee") m.brain.engage(target, 0.4 + Math.random() * 0.6);
  }

  onDeath(n, game) {
    const alive = this.alive;
    if (!alive.length) {
      if (this.onWiped) this.onWiped(this);
      game.events.emit("groupWiped", this);
      return;
    }
    const ratio = alive.length / Math.max(1, this.initial);
    const officerDown = n === this.officer;
    if (this.team !== "persian" && !officerDown) return;
    for (const m of alive) {
      const morale = (m.def && m.def.morale) || 0.5;
      let p = 0;
      if (officerDown) p = 0.75 - morale * 0.5;
      else if (ratio < 0.6) p = (0.6 - ratio) * (1.3 - morale);
      if (m.def && m.def.boss) p = 0;
      if (Math.random() < p) m.brain.flee(12 + Math.random() * 8);
    }
    if (officerDown) this.officer = null;
  }
}

export class Brain {
  constructor(npc) {
    this.npc = npc;
    this.game = npc.game;
    this.state = npc.role === "civilian" ? "wander" : "idle";
    this.home = npc.pos.clone();
    this.target = null;
    this.aw = 0;
    this.lastSeen = new THREE.Vector3();
    this.lostT = 0;
    this.tick = Math.random() * 0.3;
    this.t = 0;
    this.wanderTo = null;
    this.waitT = 0;
    this.script = null;
    this.order = null;
    this.blockT = 0;
    this.fleeT = 0;
    this.fleeFrom = null;
    this.engageDelay = 0;
    this.phase = 0;
    this.spookT = 0;
    this.cavPass = 0;
    this.heard = null;
    this.retreatT = 0;
    this.holdPos = null;
    this.slot = Math.random() * Math.PI * 2;
    this.idleLook = 0;
  }

  setHome(p) {
    this.home.copy(p);
  }

  engage(target, delay = 0) {
    if (this.npc.role === "civilian" || this.npc.role === "noncombat") { this.flee(15, target); return; }
    this.target = target;
    this.engageDelay = delay;
    this.aw = 1;
    this.lastSeen.copy(target.pos);
    this.lostT = 0;
    if (this.state !== "script") this.state = "combat";
  }

  flee(t, from = null) {
    this.state = "flee";
    this.fleeT = t;
    this.fleeFrom = from ? from.pos.clone() : this.target ? this.target.pos.clone() : null;
    this.npc.blocking = false;
  }

  hostile(a) {
    return this.game.combat.hostile(this.npc, a);
  }

  visibleRange(a) {
    const g = this.game;
    let r = 60 * g.world.sky.visibilityFactor;
    if (a.crouch) r *= 0.55;
    if (a.isPlayer && g.world.isForest && g.world.isForest(a.pos.x, a.pos.z)) r *= 0.75;
    if (a.isPlayer && a.noiseT > 0) r = Math.max(r, 90);
    if (a.mount) r *= 1.3;
    if (a.torch && g.world.sky.isNight) r = Math.max(r, 70);
    return r;
  }

  los(a) {
    const g = this.game;
    const e = this.npc.headPos(tmpA);
    const t = a.chestPos ? a.chestPos(tmpB) : tmpB.copy(a.pos).setY(a.pos.y + 1);
    const terr = g.world.terrain;
    const d = e.distanceTo(t);
    const n = Math.ceil(d / 3);
    for (let i = 1; i < n; i++) {
      const f = i / n;
      const x = e.x + (t.x - e.x) * f, y = e.y + (t.y - e.y) * f, z = e.z + (t.z - e.z) * f;
      if (terr.height(x, z) > y + 0.2) return false;
    }
    if (d < 70 && g.world.colliders.segmentBlocked(e.x, e.y, e.z, t.x, t.y, t.z)) return false;
    return true;
  }

  sense(dt) {
    const n = this.npc, g = this.game;
    let best = null, bestD = Infinity;
    const range = 75;
    for (const a of g.actors.near(n.pos.x, n.pos.z, range)) {
      if (a === n || a.dead || !this.hostile(a)) continue;
      const d = n.distTo(a);
      const vr = this.visibleRange(a);
      const alerted = this.state === "combat" || (n.group && n.group.alerted);
      if (d > vr && !(alerted && d < vr * 1.3)) continue;
      if (!alerted && d > 3) {
        const dx = a.pos.x - n.pos.x, dz = a.pos.z - n.pos.z;
        const c = (dx * Math.sin(n.yaw) + dz * Math.cos(n.yaw)) / (d || 1);
        if (c < (d < 15 ? 0.0 : 0.7)) continue;
      }
      if (!this.los(a)) continue;
      if (d < bestD) { bestD = d; best = a; }
    }
    if (best) {
      const rate = (0.9 + 28 / Math.max(3, bestD)) * (this.state === "combat" ? 4 : 1) * (best.attackCd > 0 || best.noiseT > 0 ? 2.5 : 1);
      this.aw = Math.min(1.5, this.aw + dt * rate);
      if (best.isPlayer) best.seenBy = Math.max(best.seenBy || 0, Math.min(1, this.aw));
      if (this.aw >= 1) {
        if (this.state !== "combat" && this.state !== "flee") {
          this.engage(best);
          if (n.group) n.group.alert(best, n);
          g.events.emit("spotted", { by: n, target: best });
          g.audio && g.audio.shout(n.pos, n.team);
        } else if (this.state === "combat") {
          if (!this.target || this.target.dead || n.distTo(this.target) > bestD + 8) this.target = best;
        }
        this.lastSeen.copy(best.pos);
        this.lostT = 0;
      } else if (this.aw > 0.35 && this.state !== "combat" && this.state !== "script") {
        this.heard = best.pos.clone();
        if (this.state !== "investigate") { this.prevState = this.state; this.state = "investigate"; this.t = 0; }
      }
    } else {
      this.aw = Math.max(0, this.aw - dt * 0.25);
      if (this.state === "combat") this.lostT += dt;
    }
    const noise = g.combat.hearNoise(n);
    if (noise && this.state !== "combat" && this.state !== "flee" && this.state !== "script") {
      if (noise.loud && noise.src && this.hostile(noise.src) && n.distTo(noise.pos) < 60) {
        this.engage(noise.src);
        if (n.group) n.group.alert(noise.src, n);
      } else {
        this.heard = noise.pos.clone();
        this.prevState = this.state === "investigate" ? this.prevState : this.state;
        this.state = "investigate";
        this.t = 0;
      }
    }
  }

  update(dt, camD) {
    const n = this.npc;
    this.tick -= dt;
    if (this.tick <= 0) {
      const iv = camD > 160 ? 0.8 : 0.28;
      this.sense(iv);
      this.tick = iv;
    }
    this.t += dt;
    this.blockT = Math.max(0, this.blockT - dt);
    n.blocking = this.blockT > 0;
    if (n.blocking) n.holdPose("Block", 0.3);
    if (this.spookT > 0) this.spookT -= dt;
    switch (this.state) {
      case "combat": return this.combat(dt);
      case "flee": return this.doFlee(dt);
      case "investigate": return this.investigate(dt);
      case "script": return this.doScript(dt);
      case "patrol": return this.doPatrol(dt);
      case "follow": return this.doFollow(dt);
      case "wander": return this.doWander(dt);
      case "guard": return this.doGuard(dt);
      case "hidden": return;
      default: return this.doIdle(dt);
    }
  }

  doIdle(dt) {
    const n = this.npc;
    const d = n.distTo(this.home);
    if (d > 3) n.moveTo(this.home.x, this.home.z, d > 20 ? "run" : "walk", dt, 1.5);
    else n.stop(dt);
    this.idleLook -= dt;
    if (this.idleLook <= 0) {
      this.idleLook = 3 + Math.random() * 5;
      this.lookYaw = Math.random() < 0.4 ? Math.random() * Math.PI * 2 - Math.PI : n.yaw + (Math.random() - 0.5) * 1.6;
      while (this.lookYaw - n.yaw > Math.PI) this.lookYaw -= Math.PI * 2;
      while (this.lookYaw - n.yaw < -Math.PI) this.lookYaw += Math.PI * 2;
    }
    if (this.lookYaw !== undefined && d <= 3) n.yaw += (this.lookYaw - n.yaw) * Math.min(1, dt * 2);
  }

  doGuard(dt) {
    const n = this.npc;
    const d = n.distTo(this.home);
    if (d > 1.5) n.moveTo(this.home.x, this.home.z, "walk", dt, 1);
    else { n.stop(dt); if (this.guardYaw !== undefined) n.yaw += (this.guardYaw - n.yaw) * Math.min(1, dt * 3); }
  }

  doWander(dt) {
    const n = this.npc;
    if (!this.wanderTo || this.waitT > 0) {
      this.waitT -= dt;
      n.stop(dt);
      if (this.waitT <= 0) {
        const spots = this.spots || [];
        if (spots.length && Math.random() < 0.6) {
          const s = spots[Math.floor(Math.random() * spots.length)];
          this.wanderTo = new THREE.Vector3(s[0] + (Math.random() - 0.5) * 6, 0, s[1] + (Math.random() - 0.5) * 6);
        } else {
          const a = Math.random() * Math.PI * 2, r = 4 + Math.random() * (this.wanderR || 18);
          this.wanderTo = new THREE.Vector3(this.home.x + Math.cos(a) * r, 0, this.home.z + Math.sin(a) * r);
        }
      }
      return;
    }
    const d = n.moveTo(this.wanderTo.x, this.wanderTo.z, "walk", dt, 1.2);
    if (d < 1.3 || n.stuck > 2) {
      this.wanderTo = null;
      n.stuck = 0;
      this.waitT = 4 + Math.random() * 10;
      if (n.role === "civilian" && Math.random() < 0.3) n.idleClip = Math.random() < 0.5 ? "Talk" : "Idle";
      else n.idleClip = null;
    }
  }

  doPatrol(dt) {
    const n = this.npc, gr = n.group;
    if (!gr || !gr.patrol) return this.doIdle(dt);
    const lead = gr.alive.find(m => m.brain.state === "patrol") || n;
    if (lead === n) {
      const p = gr.patrol[gr.patrolI % gr.patrol.length];
      const d = n.moveTo(p[0], p[1], "walk", dt, 3);
      if (d < 4 || n.stuck > 3) {
        gr.patrolI++;
        n.stuck = 0;
        if (gr.patrolI >= gr.patrol.length && !gr.loop) gr.patrolI = gr.patrol.length - 1;
      }
      gr.anchor.copy(n.pos);
    } else {
      const i = gr.members.indexOf(n);
      const back = 2.2 * (1 + Math.floor(i / 2));
      const side = (i % 2 ? 1 : -1) * 1.4;
      const fx = Math.sin(lead.yaw), fz = Math.cos(lead.yaw);
      const tx = lead.pos.x - fx * back + fz * side, tz = lead.pos.z - fz * back - fx * side;
      const d = Math.hypot(tx - n.pos.x, tz - n.pos.z);
      n.moveTo(tx, tz, d > 6 ? "run" : "walk", dt, 0.8);
    }
  }

  doFollow(dt) {
    const n = this.npc, g = this.game;
    const leader = this.leader || g.player;
    if (!leader || leader.dead) return this.doIdle(dt);
    const order = this.order || "follow";
    if (order === "hold" && this.holdPos) {
      const d = n.distTo(this.holdPos);
      if (d > 1.5) n.moveTo(this.holdPos.x, this.holdPos.z, "run", dt, 1);
      else n.stop(dt);
      return this.lookForFight(dt, 45);
    }
    if (order === "retreat") {
      const away = g.player.forward(new THREE.Vector3()).multiplyScalar(-25).add(g.player.pos);
      n.moveTo(away.x, away.z, "sprint", dt, 2);
      return;
    }
    const idx = this.followIndex || 0;
    const row = Math.floor(idx / 4), col = idx % 4 - 1.5;
    const ref = leader.mount || leader;
    const fx = Math.sin(ref.yaw), fz = Math.cos(ref.yaw);
    const back = 3 + row * 2.2;
    const tx = leader.pos.x - fx * back + fz * col * 1.8, tz = leader.pos.z - fz * back - fx * col * 1.8;
    const d = Math.hypot(tx - n.pos.x, tz - n.pos.z);
    if (n.mount) n.moveTo(tx, tz, d > 20 ? "sprint" : d > 6 ? "run" : "walk", dt, 2);
    else n.moveTo(tx, tz, d > 14 ? "sprint" : d > 4 ? "run" : "walk", dt, 1.2);
    if (d > 140 && n.distTo(g.rig.cam.position) > 60) {
      n.pos.set(tx, g.world.ground(tx, tz), tz);
    }
    this.lookForFight(dt, order === "attack" ? 90 : 35);
  }

  lookForFight(dt, r) {
    const n = this.npc, g = this.game;
    this.scanT = (this.scanT || 0) - dt;
    if (this.scanT > 0) return;
    this.scanT = 0.5;
    let best = null, bd = r;
    for (const a of g.actors.near(n.pos.x, n.pos.z, r)) {
      if (a.dead || !this.hostile(a) || a.team === "wild") continue;
      if (a.brain && a.brain.state === "hidden") continue;
      const d = n.distTo(a);
      if (d < bd && (d < 15 || this.los(a))) { bd = d; best = a; }
    }
    if (best) this.engage(best);
  }

  investigate(dt) {
    const n = this.npc;
    if (!this.heard) { this.state = this.prevState || "idle"; return; }
    const d = n.moveTo(this.heard.x, this.heard.z, this.t > 2 ? "run" : "walk", dt, 2.5);
    if (d < 3 || this.t > 14 || n.stuck > 3) {
      n.stop(dt);
      if (this.t > 18 || n.stuck > 3) {
        this.state = this.prevState || "idle";
        this.heard = null;
        this.aw = 0;
        n.stuck = 0;
      }
    }
  }

  doScript(dt) {
    const n = this.npc, s = this.script;
    if (!s) { this.state = "idle"; return; }
    if (s.engageNear && this.target && !this.target.dead && n.distTo(this.target) < s.engageNear) {
      this.combat(dt);
      return;
    }
    if (s.waitFor && !s.waitFor.dead && n.distTo(s.waitFor) > (s.waitR || 28)) {
      n.stop(dt);
      n.face(s.waitFor.pos, dt, 3);
    } else if (s.to) {
      const d = n.moveTo(s.to[0], s.to[1], s.mode || "walk", dt, s.stop || 1.5);
      if (d < (s.stop || 1.5) + 0.3) {
        if (s.path && s.path.length) {
          s.to = s.path.shift();
        } else {
          s.to = null;
          if (s.onArrive) { const f = s.onArrive; s.onArrive = null; f(n); }
        }
      }
    } else {
      n.stop(dt);
      if (s.face) n.face(s.face, dt, 4);
      if (s.anim) n.idleClip = s.anim;
    }
    if (s.fight !== false) this.lookForFight(dt, s.fightR || 20);
    if (this.state === "combat") this.state = "script";
  }

  doFlee(dt) {
    const n = this.npc;
    this.fleeT -= dt;
    if (n.role === "civilian" && this.hideAt) {
      const d = n.moveTo(this.hideAt[0], this.hideAt[1], "sprint", dt, 1.2);
      if (d < 1.5) {
        this.state = "hidden";
        n.root.visible = false;
        this.hiddenT = 20 + Math.random() * 20;
        setTimeout(() => this.unhide(), this.hiddenT * 1000);
      }
      return;
    }
    let away;
    if (this.fleeFrom) {
      const dx = n.pos.x - this.fleeFrom.x, dz = n.pos.z - this.fleeFrom.z;
      const l = Math.hypot(dx, dz) || 1;
      away = [n.pos.x + dx / l * 20, n.pos.z + dz / l * 20];
    } else {
      away = [this.home.x, this.home.z];
    }
    n.moveTo(away[0], away[1], "sprint", dt, 1);
    if (this.fleeT <= 0) {
      this.state = n.group && n.group.alerted && this.target && !this.target.dead && n.role !== "civilian" ? "combat" : n.role === "civilian" ? "wander" : "idle";
      if (this.state === "combat" && Math.random() < 0.5) this.state = "idle";
    }
  }

  unhide() {
    if (this.npc.dead || this.state !== "hidden") return;
    this.npc.root.visible = true;
    this.state = "wander";
  }

  combat(dt) {
    const n = this.npc, g = this.game;
    if (this.engageDelay > 0) { this.engageDelay -= dt; n.stop(dt); if (this.target) n.face(this.target.pos, dt); return; }
    let tg = this.target;
    if (!tg || tg.dead || (tg.brain && tg.brain.state === "hidden")) {
      this.target = null;
      this.lookForFight(0.6, 60);
      if (!this.target) {
        if (n.group && n.group.alive.some(m => m !== n && m.brain.target && !m.brain.target.dead)) {
          const m = n.group.alive.find(m => m !== n && m.brain.target && !m.brain.target.dead);
          this.target = m.brain.target;
        } else {
          this.state = this.followerOf ? "follow" : this.defaultState || "idle";
          this.aw = 0.3;
          if (n.group) n.group.alerted = false;
          n.blocking = false;
          return;
        }
      }
      tg = this.target;
    }
    if (this.lostT > 10) {
      this.heard = this.lastSeen.clone();
      this.prevState = this.defaultState || "idle";
      this.state = "investigate";
      this.t = 0;
      this.lostT = 0;
      return;
    }
    if (n.unitId && n.def.boss) this.bossPhases();
    const role = n.role;
    if (role === "cavalry" || n.mount) return this.cavalry(dt, tg);
    if (role === "musket" || role === "skirmisher" || role === "archer") return this.shooter(dt, tg, role);
    if (role === "officer") return this.officer(dt, tg);
    if (role === "crew") return this.crew(dt, tg);
    if (role === "zamburak") return this.zamburak(dt, tg);
    if (role === "forager") { this.flee(20, tg); return; }
    return this.melee(dt, tg);
  }

  melee(dt, tg) {
    const n = this.npc;
    const w = WEAPONS[n.meleeW || n.heldId] || WEAPONS.saber;
    if (n.heldId !== w.id) n.setWeapon(w.id);
    const d = n.distTo(tg);
    const reach = w.range * 0.85 + (tg.mount ? 0.6 : 0);
    if (d > reach) {
      const side = Math.sin(this.slot) * Math.min(3, d * 0.2);
      const fx = (tg.pos.x - n.pos.x) / d, fz = (tg.pos.z - n.pos.z) / d;
      n.moveTo(tg.pos.x - fx * (reach * 0.8) + fz * side, tg.pos.z - fz * (reach * 0.8) - fx * side, d > 10 ? "sprint" : "run", dt, 0.3);
      return;
    }
    n.stop(dt);
    n.face(tg.pos, dt, 10);
    const tgAttacking = (tg.pendingStrike || tg.strike) && tg.distTo(n) < 3.2;
    if (tgAttacking && !n.blocking && this.blockT <= 0 && Math.random() < (n.acc || 0.5) * 0.5 * dt * 10) {
      this.blockT = 0.7;
      return;
    }
    if (!n.blocking && n.facing(tg.pos, 0.85)) n.meleeAttack(tg);
  }

  shooter(dt, tg, role) {
    const n = this.npc, g = this.game;
    const d = n.distTo(tg);
    const wid = n.canShoot();
    const w = wid ? WEAPONS[wid] : null;
    if (!w || d < 4.5 || (w.kind === "gun" && !n.loaded[wid] && d < 9 && n.meleeW)) {
      if (n.meleeW) return this.melee(dt, tg);
    }
    if (!w) return this.melee(dt, tg);
    const gr = n.group;
    if (w.kind === "gun" && !n.loaded[wid]) {
      n.aimT = 0;
      if (role === "skirmisher" && this.retreatT < 2.5) {
        this.retreatT += dt;
        const dx = n.pos.x - tg.pos.x, dz = n.pos.z - tg.pos.z, l = Math.hypot(dx, dz) || 1;
        n.moveTo(n.pos.x + dx / l * 6, n.pos.z + dz / l * 6, "run", dt, 0.5);
        return;
      }
      n.stop(dt);
      n.face(tg.pos, dt, 4);
      n.reloadStep(dt);
      return;
    }
    this.retreatT = 0;
    const range = Math.min(w.range * 0.75, 85);
    const visible = this.lostT < 0.6;
    if (d > range || !visible) {
      const tx = visible ? tg.pos.x : this.lastSeen.x, tz = visible ? tg.pos.z : this.lastSeen.z;
      n.aimT = 0;
      n.moveTo(tx, tz, d > 40 ? "run" : "walk", dt, range * 0.6);
      return;
    }
    if (gr && gr.officer && !gr.officer.dead && gr.team === "persian" && w.kind === "gun" && gr.alive.length > 2) {
      const shooters = gr.alive.filter(m => (m.role === "musket") && m.brain.state === "combat");
      const ready = shooters.filter(m => m.loaded[m.canShoot()] && m.aimT > 0.6).length;
      if (g.engine.time > gr.volleyGo) {
        if (ready >= Math.max(2, shooters.length * 0.6) || gr.volleyWait > 5) {
          gr.volleyGo = g.engine.time + 0.6;
          gr.volleyWait = 0;
          if (gr.officer.distTo(g.player) < 80) g.ui && g.ui.subtitle("Юзбаши: «Атеш!» — Огонь!", 1.5);
        } else gr.volleyWait += dt / Math.max(1, shooters.length);
      }
      n.volleyHold = g.engine.time > gr.volleyGo;
    } else n.volleyHold = false;
    if (n.volleyHold && n.aimT < 0.8) n.aimT += dt;
    n.stop(dt);
    const r = n.shootAt(tg, n.volleyHold ? 0 : dt);
    if (r === "fired" && role === "skirmisher") this.retreatT = 0;
  }

  officer(dt, tg) {
    const n = this.npc;
    const d = n.distTo(tg);
    if (n.rangedW && n.loaded[n.rangedW] && d > 6 && d < 22) {
      n.stop(dt);
      const r = n.shootAt(tg, dt);
      if (r !== "none") return;
    }
    if (n.rangedW && !n.loaded[n.rangedW] && d > 14) {
      n.stop(dt);
      n.face(tg.pos, dt);
      n.reloadStep(dt);
      return;
    }
    this.melee(dt, tg);
  }

  crew(dt, tg) {
    const n = this.npc, g = this.game;
    if (n.distTo(tg) < 20) return this.melee(dt, tg);
    const c = n.cannon;
    if (c && !(g.state.spiked || []).includes(c.tag + ":" + c.i)) {
      const d = Math.hypot(tg.pos.x - c.x, tg.pos.z - c.z);
      this.ccd = (this.ccd === undefined ? 3 + Math.random() * 6 : this.ccd) - dt;
      if (this.ccd <= 0 && d > 35 && d < 420) {
        this.ccd = 12 + Math.random() * 5;
        const o = new THREE.Vector3(c.x + Math.sin(c.yaw) * 1.6, g.world.ground(c.x, c.z) + 1.1, c.z + Math.cos(c.yaw) * 1.6);
        const aim = tg.pos.clone();
        const err = d * 0.07;
        aim.x += (Math.random() - 0.5) * err;
        aim.z += (Math.random() - 0.5) * err;
        g.combat.cannonball(n, o, aim, 1.2 + d / 200);
        g.effects.smoke(o, new THREE.Vector3(Math.sin(c.yaw), 0.3, Math.cos(c.yaw)), 24, 2.2);
        g.effects.flash(o);
      }
    }
    const d = n.distTo(this.home);
    if (d > 2) n.moveTo(this.home.x, this.home.z, "run", dt, 1);
    else { n.stop(dt); n.face(tg.pos, dt, 2); }
  }

  zamburak(dt, tg) {
    const n = this.npc, g = this.game;
    const camel = n.camelActor;
    if (!camel || camel.dead) return this.melee(dt, tg);
    const d = camel.distTo(tg);
    if (d < 7) return this.melee(dt, tg);
    n.stop(dt);
    n.face(tg.pos, dt, 3);
    camel.yaw += (Math.atan2(tg.pos.x - camel.pos.x, tg.pos.z - camel.pos.z) - camel.yaw) * Math.min(1, dt);
    this.zcd = (this.zcd || 2) - dt;
    if (this.zcd <= 0 && this.spookT <= 0 && d < 210 && this.los(tg)) {
      this.zcd = 7 + Math.random() * 2;
      const o = camel.pos.clone();
      o.y += 2.8;
      const aim = tg.chestPos ? tg.chestPos(new THREE.Vector3()) : tg.pos.clone();
      g.combat.grapeshot(n, o, aim.sub(o).normalize(), 10, 30);
    }
  }

  cavalry(dt, tg) {
    const n = this.npc, g = this.game;
    const h = n.mount;
    if (!h || h.dead) { n.role = n.def.weapon === "bow" ? "archer" : "melee"; return this.melee(dt, tg); }
    const d = n.distTo(tg);
    const tight = g.world.colliders.query(tg.pos.x, tg.pos.z, 6).length > 2;
    const nrm = g.world.terrain.normal(tg.pos.x, tg.pos.z);
    if ((tight || nrm.y < 0.72 || h.blocked > 3) && d < 35 && n.role !== "boss") {
      h.dismount();
      n.role = "melee";
      h.blocked = 0;
      return;
    }
    const w = WEAPONS[n.meleeW || n.primary] || WEAPONS.saber;
    if (n.rangedW && WEAPONS[n.rangedW].kind === "bow" && d > 18 && d < 60 && (this.circleT = (this.circleT || 0) + dt) % 10 < 6) {
      const a = Math.atan2(n.pos.x - tg.pos.x, n.pos.z - tg.pos.z) + 0.4;
      n.moveTo(tg.pos.x + Math.sin(a) * 30, tg.pos.z + Math.cos(a) * 30, "run", dt, 2);
      n.aimT += dt;
      if (n.aimT > 1.8) {
        n.aimT = 0;
        if (n.heldId !== n.rangedW) n.setWeapon(n.rangedW);
        else {
          const m = n.chestPos(new THREE.Vector3());
          m.y += 0.4;
          const aim = tg.chestPos ? tg.chestPos(new THREE.Vector3()) : tg.pos.clone();
          aim.y += d * d * 4.9 / (58 * 58);
          g.combat.arrow(n, WEAPONS[n.rangedW], m, aim.sub(m).normalize(), 0.9, 0.04);
        }
      }
      return;
    }
    if (n.heldId !== w.id) n.setWeapon(w.id);
    if (this.cavPass > 0) {
      this.cavPass -= dt;
      const f = h.forward(new THREE.Vector3());
      n.moveTo(h.pos.x + f.x * 20, h.pos.z + f.z * 20, "sprint", dt, 1);
      return;
    }
    const dx = tg.pos.x - n.pos.x, dz = tg.pos.z - n.pos.z;
    const l = Math.hypot(dx, dz) || 1;
    n.moveTo(tg.pos.x + dx / l * 6, tg.pos.z + dz / l * 6, d < 30 ? "sprint" : "run", dt, 0.5);
    if (d < w.range + 1.4 && n.attackCd <= 0) {
      n.meleeAttack(tg);
      this.cavPass = 1.6;
    }
  }

  bossPhases() {
    const n = this.npc, g = this.game;
    const f = n.hp / n.maxHp;
    if (this.phase === 0 && f < 0.5) {
      this.phase = 1;
      g.ui && g.ui.subtitle(`${n.name}: «Ко мне, гвардия!»`, 3);
      if (g.actors.spawnGroupNear) g.actors.spawnGroupNear(n, [["guard_foot", 3]], 12);
    }
    if (this.phase === 1 && f < 0.25) {
      this.phase = 2;
      n.speedMul = 1.25;
      n.acc = Math.min(0.95, n.acc + 0.1);
      g.ui && g.ui.subtitle(`${n.name} в ярости`, 2);
    }
  }
}

export class AnimalBrain {
  constructor(a) {
    this.a = a;
    this.game = a.game;
    this.state = "wander";
    this.home = a.pos.clone();
    this.wanderTo = null;
    this.waitT = Math.random() * 5;
    this.target = null;
    this.atkCd = 0;
    this.tick = Math.random();
    this.fleeT = 0;
  }

  update(dt) {
    const a = this.a, g = this.game;
    this.atkCd = Math.max(0, this.atkCd - dt);
    this.tick -= dt;
    if (this.tick <= 0) {
      this.tick = 0.4;
      this.think();
    }
    const role = a.role;
    if (this.state === "flee" && this.target) {
      this.fleeT -= dt;
      const dx = a.pos.x - this.target.pos.x, dz = a.pos.z - this.target.pos.z, l = Math.hypot(dx, dz) || 1;
      this.steer(a.pos.x + dx / l * 20, a.pos.z + dz / l * 20, 10 * (a.def.speed || 1), dt);
      if (this.fleeT <= 0) { this.state = "wander"; this.target = null; }
      return;
    }
    if (this.state === "hunt" && this.target && !this.target.dead) {
      const d = a.distTo(this.target);
      if (d > 2.0 + (this.target.mount ? 0.8 : 0)) this.steer(this.target.pos.x, this.target.pos.z, 9 * (a.def.speed || 1), dt);
      else {
        a.speed *= 0.5;
        a.yaw += (Math.atan2(this.target.pos.x - a.pos.x, this.target.pos.z - a.pos.z) - a.yaw) * Math.min(1, dt * 6);
        if (this.atkCd <= 0) {
          this.atkCd = 1.3 + Math.random() * 0.6;
          a.play(a.has("Attack") ? "Attack" : "Idle", { fade: 0.1 });
          setTimeout(() => {
            if (!a.dead && this.target && !this.target.dead && a.distTo(this.target) < 2.8) g.combat.damage(this.target, a, a.def.dmg || 15, { type: "bite" });
          }, 400);
        }
      }
      return;
    }
    if (role === "companion") {
      const p = g.player;
      const d = a.distTo(p);
      if (d > 4) this.steer(p.pos.x - Math.sin(p.yaw) * 2.5, p.pos.z - Math.cos(p.yaw) * 2.5, d > 12 ? 10 : 4, dt);
      else a.speed *= 0.85;
      if (d > 120) a.pos.set(p.pos.x - 3, p.pos.y, p.pos.z - 3);
      return;
    }
    if (!this.wanderTo || this.waitT > 0) {
      this.waitT -= dt;
      a.speed *= 0.9;
      a.grazing = role === "herbivore";
      if (this.waitT <= 0) {
        const ang = Math.random() * Math.PI * 2, r = 6 + Math.random() * 30;
        this.wanderTo = [this.home.x + Math.cos(ang) * r, this.home.z + Math.sin(ang) * r];
      }
      return;
    }
    a.grazing = false;
    this.steer(this.wanderTo[0], this.wanderTo[1], 1.5, dt);
    if (Math.hypot(a.pos.x - this.wanderTo[0], a.pos.z - this.wanderTo[1]) < 2 || a.blocked > 2) {
      this.wanderTo = null;
      a.blocked = 0;
      this.waitT = 5 + Math.random() * 12;
    }
  }

  steer(x, z, speed, dt) {
    const a = this.a;
    const want = Math.atan2(x - a.pos.x, z - a.pos.z);
    let d = want - a.yaw;
    while (d > Math.PI) d -= Math.PI * 2;
    while (d < -Math.PI) d += Math.PI * 2;
    a.yaw += d * Math.min(1, dt * 4);
    a.speed += (speed - a.speed) * Math.min(1, dt * 3);
  }

  think() {
    const a = this.a, g = this.game;
    const role = a.role;
    if (role === "companion") {
      let best = null, bd = 25;
      for (const o of g.actors.near(a.pos.x, a.pos.z, 25)) {
        if (o.dead || o === a || !g.combat.hostile(g.player, o) || o.team === "wild") continue;
        const d = a.distTo(o);
        if (d < bd && (o.brain && o.brain.state === "combat" || d < 10)) { bd = d; best = o; }
      }
      if (best) { this.state = "hunt"; this.target = best; }
      else if (this.state === "hunt" && (!this.target || this.target.dead)) { this.state = "follow"; this.target = null; }
      return;
    }
    let threat = null, td = role === "predator" ? (g.world.sky.isNight ? 45 : 18) : 22;
    for (const o of g.actors.near(a.pos.x, a.pos.z, td)) {
      if (o.dead || o === a || o.team === a.team || o.kind === "animal" || o.kind === "horse") continue;
      const d = a.distTo(o);
      if (d < td) { td = d; threat = o; }
    }
    if (!threat) { if (this.state === "hunt" && (!this.target || this.target.dead || a.distTo(this.target) > 60)) this.state = "wander"; return; }
    if (role === "herbivore") { this.state = "flee"; this.target = threat; this.fleeT = 6; return; }
    if (role === "predator") {
      if (a.hp < a.maxHp * 0.3) { this.state = "flee"; this.target = threat; this.fleeT = 10; return; }
      this.state = "hunt";
      this.target = threat;
    }
  }
}
